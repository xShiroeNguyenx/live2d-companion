import { CubismMath } from '@framework/math/cubismmath';
import { MotionSegmentType } from '@shared/types/live2d-files';
import type { Keyframe, MotionDocument, MotionTrack } from './MotionDocument';

/**
 * Evaluates a motion curve at an arbitrary time.
 *
 * This exists instead of playing the motion through `CubismMotion` because an
 * editor needs to scrub: jump to 2.4s, show that frame, and do it again on the
 * next pointer-move. The framework's player advances by a delta through a queue,
 * which cannot seek backwards.
 *
 * The cost of a second implementation is that it must agree with the framework
 * exactly, or the editor previews a curve that plays differently in VTube Studio.
 * Two things keep them aligned:
 *
 *  - Both bezier modes are implemented, matching how the framework picks between
 *    them from `AreBeziersRestricted`.
 *  - The unrestricted mode calls the framework's own `cardanoAlgorithmForBezier`
 *    rather than re-deriving the cubic solve, so the numerically delicate part
 *    is shared code, not a copy.
 *
 * `tests/unit/motion-evaluator.test.ts` samples real motions and compares
 * against `CubismMotion` playback.
 */
export function evaluateTrack(
  track: MotionTrack,
  time: number,
  areBeziersRestricted: boolean
): number {
  const keyframes = track.keyframes;
  if (keyframes.length === 0) return 0;
  if (keyframes.length === 1) return keyframes[0].value;

  // Before the first keyframe the curve holds its opening value; after the last
  // it holds its final value. This matches the framework, which clamps `t` into
  // the segment rather than extrapolating.
  if (time <= keyframes[0].time) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last.value;

  const index = findSegment(keyframes, time);
  const from = keyframes[index];
  const to = keyframes[index + 1];
  const type = from.out?.type ?? MotionSegmentType.Linear;

  switch (type) {
    case MotionSegmentType.Stepped:
      // Holds the starting value until the next keyframe is reached.
      return from.value;

    case MotionSegmentType.InverseStepped:
      // Jumps to the ending value immediately on leaving the keyframe.
      return to.value;

    case MotionSegmentType.Bezier: {
      const control1 = from.out?.control1;
      const control2 = from.out?.control2;
      // A bezier missing its handles degrades to linear rather than throwing:
      // the preview should keep running while the user is mid-edit.
      if (!control1 || !control2) return linear(from, to, time);
      return areBeziersRestricted
        ? bezierParametric(from, control1, control2, to, time)
        : bezierCardano(from, control1, control2, to, time);
    }

    case MotionSegmentType.Linear:
    default:
      return linear(from, to, time);
  }
}

/** Every track's value at one time, keyed by track index. */
export function evaluateMotion(document: MotionDocument, time: number): number[] {
  return document.tracks.map((track) =>
    evaluateTrack(track, time, document.areBeziersRestricted)
  );
}

/** Binary search for the segment containing `time`. */
function findSegment(keyframes: Keyframe[], time: number): number {
  let low = 0;
  let high = keyframes.length - 1;

  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (keyframes[middle].time <= time) low = middle;
    else high = middle;
  }
  return low;
}

function linear(from: Keyframe, to: Keyframe, time: number): number {
  const span = to.time - from.time;
  if (span <= 0) return to.value;
  const t = clamp01((time - from.time) / span);
  return from.value + (to.value - from.value) * t;
}

interface Point {
  time: number;
  value: number;
}

/**
 * Bezier evaluated with `t` taken straight from elapsed time.
 *
 * What the framework does when handles are restricted: cheap, and correct
 * because clamped handles keep time monotonic across the segment.
 */
function bezierParametric(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  time: number
): number {
  const span = p3.time - p0.time;
  if (span <= 0) return p3.value;
  return deCasteljauValue(p0, p1, p2, p3, clamp01((time - p0.time) / span));
}

/**
 * Bezier evaluated by solving for the `t` whose x equals `time`.
 *
 * Needed for motions authored with unrestricted handles — including the sample
 * models, which ship `AreBeziersRestricted: false` — where time is not linear in
 * `t` and the parametric shortcut would distort the curve.
 */
function bezierCardano(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  time: number
): number {
  const a = p3.time - 3 * p2.time + 3 * p1.time - p0.time;
  const b = 3 * p2.time - 6 * p1.time + 3 * p0.time;
  const c = 3 * p1.time - 3 * p0.time;
  const d = p0.time - time;

  const t = CubismMath.cardanoAlgorithmForBezier(a, b, c, d);
  return deCasteljauValue(p0, p1, p2, p3, t);
}

/** De Casteljau on the value axis, at a given curve parameter. */
function deCasteljauValue(p0: Point, p1: Point, p2: Point, p3: Point, t: number): number {
  const v01 = p0.value + (p1.value - p0.value) * t;
  const v12 = p1.value + (p2.value - p1.value) * t;
  const v23 = p2.value + (p3.value - p2.value) * t;
  const v012 = v01 + (v12 - v01) * t;
  const v123 = v12 + (v23 - v12) * t;
  return v012 + (v123 - v012) * t;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
