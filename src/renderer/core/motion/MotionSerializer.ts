import {
  MotionSegmentType,
  type Motion3Curve,
  type Motion3Json
} from '@shared/types/live2d-files';
import {
  DEFAULT_FADE_SECONDS,
  computeContentDuration,
  type Keyframe,
  type MotionDocument,
  type MotionTrack
} from './MotionDocument';

/**
 * Converts between motion3.json and the editable keyframe model.
 *
 * The flat `Segments` array is the tricky part of the format. A curve is:
 *
 *   [t0, v0,  type, ...points,  type, ...points, ...]
 *
 * where the leading pair is the curve's first point and each following record
 * starts with a type id that determines how many numbers follow: linear (0),
 * stepped (2) and inverse-stepped (3) carry one end point (2 numbers), while
 * bezier (1) carries two control points plus the end point (6 numbers).
 *
 * `Meta` then repeats counts derived from that array. They have to be exact:
 * several third-party loaders size their buffers from these numbers up front
 * and crash or truncate the motion when they disagree with the data, so every
 * count is recomputed on save rather than carried over from the input.
 */

/** How many numbers follow a segment's type id, per segment type. */
const SEGMENT_ARITY: Record<MotionSegmentType, number> = {
  [MotionSegmentType.Linear]: 2,
  [MotionSegmentType.Bezier]: 6,
  [MotionSegmentType.Stepped]: 2,
  [MotionSegmentType.InverseStepped]: 2
};

/** How many curve points a segment contributes to `TotalPointCount`. */
const SEGMENT_POINTS: Record<MotionSegmentType, number> = {
  [MotionSegmentType.Linear]: 1,
  [MotionSegmentType.Bezier]: 3,
  [MotionSegmentType.Stepped]: 1,
  [MotionSegmentType.InverseStepped]: 1
};

export class MotionParseError extends Error {}

/** Reads motion3.json into the editable document. */
export function parseMotion(json: Motion3Json): MotionDocument {
  if (!Array.isArray(json.Curves)) {
    throw new MotionParseError('motion3.json thiếu danh sách Curves.');
  }

  const tracks = json.Curves.map((curve, index) => parseCurve(curve, index));

  return {
    duration: json.Meta?.Duration ?? 0,
    fps: json.Meta?.Fps ?? 30,
    loop: json.Meta?.Loop ?? false,
    // Preserved rather than normalised: the flag changes how the runtime
    // evaluates beziers, so flipping it would change how the motion plays.
    areBeziersRestricted: json.Meta?.AreBeziersRestricted ?? false,
    fadeInTime: json.Meta?.FadeInTime ?? DEFAULT_FADE_SECONDS,
    fadeOutTime: json.Meta?.FadeOutTime ?? DEFAULT_FADE_SECONDS,
    tracks,
    userData: (json.UserData ?? []).map((entry) => ({
      time: entry.Time,
      value: entry.Value
    }))
  };
}

function parseCurve(curve: Motion3Curve, curveIndex: number): MotionTrack {
  const segments = curve.Segments;
  if (!Array.isArray(segments) || segments.length < 2) {
    throw new MotionParseError(
      `Curve ${curveIndex} (${curve.Id}) có Segments không hợp lệ.`
    );
  }

  const keyframes: Keyframe[] = [{ time: segments[0], value: segments[1] }];

  let cursor = 2;
  while (cursor < segments.length) {
    const type = segments[cursor] as MotionSegmentType;
    const arity = SEGMENT_ARITY[type];
    if (arity === undefined) {
      throw new MotionParseError(
        `Curve ${curveIndex} (${curve.Id}): loại segment không nhận dạng được: ${type}`
      );
    }
    if (cursor + arity >= segments.length) {
      throw new MotionParseError(
        `Curve ${curveIndex} (${curve.Id}): segment bị cắt ngắn ở vị trí ${cursor}.`
      );
    }

    const previous = keyframes[keyframes.length - 1];
    if (type === MotionSegmentType.Bezier) {
      previous.out = {
        type,
        control1: { time: segments[cursor + 1], value: segments[cursor + 2] },
        control2: { time: segments[cursor + 3], value: segments[cursor + 4] }
      };
      keyframes.push({ time: segments[cursor + 5], value: segments[cursor + 6] });
    } else {
      previous.out = { type };
      keyframes.push({ time: segments[cursor + 1], value: segments[cursor + 2] });
    }

    cursor += arity + 1;
  }

  return {
    target: curve.Target,
    id: curve.Id,
    keyframes,
    fadeInTime: curve.FadeInTime,
    fadeOutTime: curve.FadeOutTime
  };
}

/**
 * Writes the document back to motion3.json, recomputing every Meta count.
 *
 * Tracks with fewer than two keyframes are dropped: a curve with a single point
 * is legal in the format but does nothing, and keeping it would inflate the
 * counts that other loaders trust.
 */
export function serializeMotion(document: MotionDocument): Motion3Json {
  const curves: Motion3Curve[] = [];
  let totalSegmentCount = 0;
  let totalPointCount = 0;

  for (const track of document.tracks) {
    if (track.keyframes.length < 2) continue;

    const segments: number[] = [track.keyframes[0].time, track.keyframes[0].value];
    // The curve's own first point always counts.
    totalPointCount += 1;

    for (let index = 0; index < track.keyframes.length - 1; index += 1) {
      const from = track.keyframes[index];
      const to = track.keyframes[index + 1];
      const type = from.out?.type ?? MotionSegmentType.Linear;

      if (type === MotionSegmentType.Bezier) {
        const control1 = from.out?.control1;
        const control2 = from.out?.control2;
        if (!control1 || !control2) {
          throw new MotionParseError(
            `Track ${track.id}: segment bezier thiếu điểm điều khiển.`
          );
        }
        segments.push(
          MotionSegmentType.Bezier,
          control1.time,
          control1.value,
          control2.time,
          control2.value,
          to.time,
          to.value
        );
      } else {
        segments.push(type, to.time, to.value);
      }

      totalSegmentCount += 1;
      totalPointCount += SEGMENT_POINTS[type];
    }

    const curve: Motion3Curve = {
      Target: track.target,
      Id: track.id,
      Segments: segments
    };
    if (track.fadeInTime !== undefined) curve.FadeInTime = track.fadeInTime;
    if (track.fadeOutTime !== undefined) curve.FadeOutTime = track.fadeOutTime;
    curves.push(curve);
  }

  const userData = document.userData.map((event) => ({
    Time: event.time,
    Value: event.value
  }));

  return {
    Version: 3,
    Meta: {
      // Never shorter than the content, or the tail of the motion is cut off.
      Duration: Math.max(document.duration, computeContentDuration(document)),
      Fps: document.fps,
      Loop: document.loop,
      AreBeziersRestricted: document.areBeziersRestricted,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
      UserDataCount: userData.length,
      // The spec counts the bytes of the event strings, not the entries.
      TotalUserDataSize: userData.reduce(
        (total, event) => total + byteLength(event.Value),
        0
      ),
      FadeInTime: document.fadeInTime,
      FadeOutTime: document.fadeOutTime
    },
    Curves: curves,
    ...(userData.length > 0 ? { UserData: userData } : {})
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Recomputes the Meta counts of an existing motion3.json without touching its
 * curves.
 *
 * Used by the export check to repair a file whose counts drifted — from a
 * different tool, or a hand edit — without re-serialising and risking any other
 * change to the data.
 */
export function recomputeMeta(json: Motion3Json): Motion3Json {
  let totalSegmentCount = 0;
  let totalPointCount = 0;

  for (const curve of json.Curves) {
    totalPointCount += 1;
    let cursor = 2;
    while (cursor < curve.Segments.length) {
      const type = curve.Segments[cursor] as MotionSegmentType;
      const arity = SEGMENT_ARITY[type];
      if (arity === undefined) break;
      totalSegmentCount += 1;
      totalPointCount += SEGMENT_POINTS[type];
      cursor += arity + 1;
    }
  }

  return {
    ...json,
    Meta: {
      ...json.Meta,
      CurveCount: json.Curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
      UserDataCount: json.UserData?.length ?? 0,
      TotalUserDataSize: (json.UserData ?? []).reduce(
        (total, event) => total + byteLength(event.Value),
        0
      )
    }
  };
}

/** Meta counts as they should be, for the export check to compare against. */
export function computeMetaCounts(json: Motion3Json): {
  curveCount: number;
  totalSegmentCount: number;
  totalPointCount: number;
} {
  const repaired = recomputeMeta(json);
  return {
    curveCount: repaired.Meta.CurveCount,
    totalSegmentCount: repaired.Meta.TotalSegmentCount,
    totalPointCount: repaired.Meta.TotalPointCount
  };
}
