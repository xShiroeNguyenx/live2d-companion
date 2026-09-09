import { MotionSegmentType } from '@shared/types/live2d-files';
import type { MotionDocument, MotionTrack } from './MotionDocument';
import { evaluateTrack } from './MotionEvaluator';

/**
 * Drives a motion in the preview: playhead position, looping, and applying the
 * curve values to the model.
 *
 * Separate from the timeline component so the playback rules can be tested
 * without a DOM, and so the runtime can keep applying the motion while the user
 * is on another tab.
 */
export interface PlaybackState {
  playing: boolean;
  /** Seconds from the start of the motion. */
  time: number;
  loop: boolean;
  /** 1 is real time; 0.5 is half speed, for inspecting fast movement. */
  speed: number;
}

export const initialPlayback: PlaybackState = {
  playing: false,
  time: 0,
  loop: true,
  speed: 1
};

/**
 * Advances the playhead by a frame.
 *
 * Returns the new time rather than mutating, so a caller can decide what to do
 * when a non-looping motion ends.
 */
export function advance(
  state: PlaybackState,
  deltaSeconds: number,
  duration: number
): { time: number; playing: boolean } {
  if (!state.playing || duration <= 0) {
    return { time: state.time, playing: state.playing };
  }

  const next = state.time + deltaSeconds * state.speed;

  if (next < duration) return { time: next, playing: true };

  if (state.loop) {
    // Modulo rather than resetting to zero, so a long frame does not swallow
    // the first moments of the next cycle.
    return { time: next % duration, playing: true };
  }
  // Stop exactly on the last frame; stopping past it would show a pose the
  // motion never reaches.
  return { time: duration, playing: false };
}

/** Which parameter ids a motion drives, for the runtime to leave alone. */
export function motionParameterIds(document: MotionDocument): string[] {
  return document.tracks
    .filter((track) => track.target === 'Parameter')
    .map((track) => track.id);
}

export interface MotionSample {
  parameters: Map<string, number>;
  partOpacities: Map<string, number>;
  /** `Target: "Model"` curves, e.g. Opacity. */
  model: Map<string, number>;
}

/**
 * Every value a motion produces at one instant.
 *
 * Grouped by target because the three kinds are applied through different model
 * APIs, and a curve naming a part has to reach `setPartOpacity`, not a parameter.
 */
export function sampleMotion(document: MotionDocument, time: number): MotionSample {
  const sample: MotionSample = {
    parameters: new Map(),
    partOpacities: new Map(),
    model: new Map()
  };

  for (const track of document.tracks) {
    const value = evaluateTrack(track, time, document.areBeziersRestricted);
    switch (track.target) {
      case 'Parameter':
        sample.parameters.set(track.id, value);
        break;
      case 'PartOpacity':
        sample.partOpacities.set(track.id, value);
        break;
      case 'Model':
        sample.model.set(track.id, value);
        break;
    }
  }
  return sample;
}

/**
 * Inserts or replaces a keyframe on a track.
 *
 * Replacing an existing keyframe at the same time is what makes repeated edits
 * at one playhead position behave: the user drags a slider twice and gets one
 * keyframe, not two at identical times which no runtime handles sensibly.
 */
export function setKeyframe(
  track: MotionTrack,
  time: number,
  value: number,
  segmentType: MotionSegmentType = MotionSegmentType.Linear
): void {
  const epsilon = 1e-4;
  const existing = track.keyframes.findIndex(
    (keyframe) => Math.abs(keyframe.time - time) < epsilon
  );

  if (existing >= 0) {
    track.keyframes[existing].value = value;
    return;
  }

  const insertAt = track.keyframes.findIndex((keyframe) => keyframe.time > time);
  const keyframe = { time, value, out: { type: segmentType } };

  if (insertAt === -1) {
    // Appending: the previous last keyframe now needs a segment leaving it, and
    // this one becomes the end of the curve.
    const previous = track.keyframes[track.keyframes.length - 1];
    if (previous && !previous.out) previous.out = { type: segmentType };
    track.keyframes.push({ time, value });
  } else {
    track.keyframes.splice(insertAt, 0, keyframe);
  }
}

/** Removes a keyframe and repairs the segment chain around it. */
export function removeKeyframe(track: MotionTrack, index: number): void {
  if (index < 0 || index >= track.keyframes.length) return;
  track.keyframes.splice(index, 1);

  // The final keyframe must not carry an outgoing segment: there is nothing
  // after it, and a serialized segment with no end point is malformed.
  const last = track.keyframes[track.keyframes.length - 1];
  if (last) delete last.out;
}

/** Moves a keyframe in time, keeping the track ordered. */
export function moveKeyframe(
  track: MotionTrack,
  index: number,
  time: number,
  value: number
): number {
  const keyframe = track.keyframes[index];
  if (!keyframe) return index;

  keyframe.time = Math.max(0, time);
  keyframe.value = value;
  track.keyframes.sort((a, b) => a.time - b.time);

  // Reordering can move the outgoing-segment responsibility to a different
  // keyframe, so rebuild the chain rather than tracking it incrementally.
  const type =
    track.keyframes.find((entry) => entry.out)?.out?.type ?? MotionSegmentType.Linear;
  for (let position = 0; position < track.keyframes.length - 1; position += 1) {
    if (!track.keyframes[position].out) track.keyframes[position].out = { type };
  }
  const last = track.keyframes[track.keyframes.length - 1];
  if (last) delete last.out;

  return track.keyframes.indexOf(keyframe);
}
