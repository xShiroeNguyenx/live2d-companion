import { MotionSegmentType } from '@shared/types/live2d-files';

/**
 * The editable shape of a motion, as keyframes rather than the flat number
 * array motion3.json stores.
 *
 * motion3.json describes a curve as `[t0, v0, type, ...points, type, ...points]`,
 * which is compact for a runtime but hostile to editing: inserting a keyframe
 * means splicing a variable number of numbers at an offset that depends on every
 * preceding segment's type. Keyframes make an insert a list insert, and the
 * serializer turns them back into the flat form on save.
 */

/** How the curve travels from this keyframe to the next one. */
export interface SegmentOut {
  type: MotionSegmentType;
  /** Bezier control points, in the same (time, value) space as the keyframes. */
  control1?: { time: number; value: number };
  control2?: { time: number; value: number };
}

export interface Keyframe {
  time: number;
  value: number;
  /**
   * The segment leaving this keyframe. Absent on the final keyframe, which has
   * nothing after it to travel to.
   */
  out?: SegmentOut;
}

export interface MotionTrack {
  target: 'Parameter' | 'PartOpacity' | 'Model';
  id: string;
  keyframes: Keyframe[];
  /** Per-curve fade overrides; absent means the motion-level values apply. */
  fadeInTime?: number;
  fadeOutTime?: number;
}

export interface MotionUserDataEvent {
  time: number;
  value: string;
}

export interface MotionDocument {
  duration: number;
  fps: number;
  loop: boolean;
  /**
   * Whether bezier handles are constrained inside their segment.
   *
   * This changes how the runtime evaluates the curve, so it is part of the
   * document rather than a save-time detail: a motion authored as unrestricted
   * would play differently if we silently flipped the flag.
   */
  areBeziersRestricted: boolean;
  fadeInTime: number;
  fadeOutTime: number;
  tracks: MotionTrack[];
  userData: MotionUserDataEvent[];
}

/** Default fades, matching what Cubism Editor writes for a new motion. */
export const DEFAULT_FADE_SECONDS = 0.5;

export function createEmptyMotion(fps = 30): MotionDocument {
  return {
    duration: 2,
    fps,
    loop: true,
    // New motions are authored with restricted handles so that what the editor
    // previews is what every runtime plays. See MotionEvaluator.
    areBeziersRestricted: true,
    fadeInTime: DEFAULT_FADE_SECONDS,
    fadeOutTime: DEFAULT_FADE_SECONDS,
    tracks: [],
    userData: []
  };
}

/** Keeps keyframes sorted, which every evaluator and serializer relies on. */
export function sortKeyframes(track: MotionTrack): void {
  track.keyframes.sort((a, b) => a.time - b.time);
}

/**
 * Default bezier handles for a segment: a third of the way in from each end.
 *
 * The same convention Cubism Editor uses, so a curve created here looks like one
 * created there.
 */
export function defaultBezierHandles(
  from: Keyframe,
  to: Keyframe
): { control1: { time: number; value: number }; control2: { time: number; value: number } } {
  const span = to.time - from.time;
  const rise = to.value - from.value;
  return {
    control1: { time: from.time + span / 3, value: from.value + rise / 3 },
    control2: { time: from.time + (span * 2) / 3, value: from.value + (rise * 2) / 3 }
  };
}

/**
 * Clamps bezier handle times into their segment.
 *
 * Required whenever the document is marked restricted: the runtime's fast
 * evaluation assumes handle times are monotonic within the segment, and a handle
 * dragged past its neighbour would make the curve fold back on itself and play
 * differently in the editor than elsewhere.
 */
export function clampHandles(track: MotionTrack): void {
  for (let index = 0; index < track.keyframes.length - 1; index += 1) {
    const from = track.keyframes[index];
    const to = track.keyframes[index + 1];
    if (from.out?.type !== MotionSegmentType.Bezier) continue;
    if (!from.out.control1 || !from.out.control2) continue;

    from.out.control1.time = Math.min(Math.max(from.out.control1.time, from.time), to.time);
    from.out.control2.time = Math.min(
      Math.max(from.out.control2.time, from.out.control1.time),
      to.time
    );
  }
}

/** The last keyframe time across all tracks, which is the motion's real length. */
export function computeContentDuration(document: MotionDocument): number {
  let last = 0;
  for (const track of document.tracks) {
    const final = track.keyframes[track.keyframes.length - 1];
    if (final && final.time > last) last = final.time;
  }
  for (const event of document.userData) {
    if (event.time > last) last = event.time;
  }
  return last;
}
