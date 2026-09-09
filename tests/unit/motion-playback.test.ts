import { describe, expect, it } from 'vitest';
import { MotionSegmentType } from '../../src/shared/types/live2d-files';
import {
  advance,
  moveKeyframe,
  removeKeyframe,
  sampleMotion,
  setKeyframe,
  type PlaybackState
} from '../../src/renderer/core/motion/MotionPlayback';
import { serializeMotion } from '../../src/renderer/core/motion/MotionSerializer';
import type { MotionDocument, MotionTrack } from '../../src/renderer/core/motion/MotionDocument';

function track(times: number[], values: number[]): MotionTrack {
  return {
    target: 'Parameter',
    id: 'ParamAngleX',
    keyframes: times.map((time, index) => ({
      time,
      value: values[index],
      // Every keyframe but the last has a segment leaving it.
      ...(index < times.length - 1 ? { out: { type: MotionSegmentType.Linear } } : {})
    }))
  };
}

function playback(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return { playing: true, time: 0, loop: true, speed: 1, ...overrides };
}

describe('advance', () => {
  it('moves the playhead forward by the frame time', () => {
    expect(advance(playback({ time: 1 }), 0.1, 5)).toEqual({ time: 1.1, playing: true });
  });

  it('scales by the playback speed', () => {
    expect(advance(playback({ time: 1, speed: 0.5 }), 0.2, 5).time).toBeCloseTo(1.1, 6);
  });

  it('does not move while paused', () => {
    expect(advance(playback({ playing: false, time: 2 }), 0.1, 5)).toEqual({
      time: 2,
      playing: false
    });
  });

  it('wraps around when looping', () => {
    const result = advance(playback({ time: 4.95 }), 0.1, 5);
    expect(result.playing).toBe(true);
    expect(result.time).toBeCloseTo(0.05, 6);
  });

  it('keeps the remainder when a long frame overshoots the loop point', () => {
    // A stalled frame must not swallow the start of the next cycle.
    const result = advance(playback({ time: 4.9 }), 0.4, 5);
    expect(result.time).toBeCloseTo(0.3, 6);
  });

  it('stops exactly on the last frame when not looping', () => {
    expect(advance(playback({ time: 4.95, loop: false }), 0.5, 5)).toEqual({
      time: 5,
      playing: false
    });
  });

  it('does nothing for a zero-length motion', () => {
    expect(advance(playback({ time: 0 }), 0.1, 0)).toEqual({ time: 0, playing: true });
  });
});

describe('sampleMotion', () => {
  const document: MotionDocument = {
    duration: 2,
    fps: 30,
    loop: true,
    areBeziersRestricted: true,
    fadeInTime: 0.5,
    fadeOutTime: 0.5,
    tracks: [
      { target: 'Parameter', id: 'ParamAngleX', keyframes: [
        { time: 0, value: 0, out: { type: MotionSegmentType.Linear } },
        { time: 2, value: 30 }
      ] },
      { target: 'PartOpacity', id: 'PartArmA', keyframes: [
        { time: 0, value: 1, out: { type: MotionSegmentType.Linear } },
        { time: 2, value: 0 }
      ] },
      { target: 'Model', id: 'Opacity', keyframes: [
        { time: 0, value: 1, out: { type: MotionSegmentType.Stepped } },
        { time: 2, value: 0.5 }
      ] }
    ],
    userData: []
  };

  it('groups values by what they drive', () => {
    // Three targets go through three different model APIs, so a caller must be
    // able to tell them apart without inspecting ids.
    const sample = sampleMotion(document, 1);
    expect(sample.parameters.get('ParamAngleX')).toBeCloseTo(15, 6);
    expect(sample.partOpacities.get('PartArmA')).toBeCloseTo(0.5, 6);
    expect(sample.model.get('Opacity')).toBe(1);
  });

  it('holds the opening value before the motion starts', () => {
    expect(sampleMotion(document, -1).parameters.get('ParamAngleX')).toBe(0);
  });

  it('holds the final value past the end', () => {
    expect(sampleMotion(document, 99).parameters.get('ParamAngleX')).toBe(30);
  });
});

describe('setKeyframe', () => {
  it('replaces the value of a keyframe already at that time', () => {
    // Dragging a slider twice at one playhead position must give one keyframe.
    const subject = track([0, 1, 2], [0, 10, 20]);
    setKeyframe(subject, 1, 99);
    expect(subject.keyframes).toHaveLength(3);
    expect(subject.keyframes[1].value).toBe(99);
  });

  it('inserts in the middle keeping the track ordered', () => {
    const subject = track([0, 2], [0, 20]);
    setKeyframe(subject, 1, 10);
    expect(subject.keyframes.map((frame) => frame.time)).toEqual([0, 1, 2]);
    expect(subject.keyframes[1].value).toBe(10);
  });

  it('appends past the end and gives the previous last keyframe a segment', () => {
    const subject = track([0, 1], [0, 10]);
    setKeyframe(subject, 3, 30);

    expect(subject.keyframes.map((frame) => frame.time)).toEqual([0, 1, 3]);
    // The old final keyframe now has something after it.
    expect(subject.keyframes[1].out).toBeDefined();
    // And the new final keyframe must not carry a dangling segment.
    expect(subject.keyframes[2].out).toBeUndefined();
  });

  it('serializes cleanly after an append', () => {
    // The real check on segment bookkeeping: the writer refuses malformed data.
    const subject = track([0, 1], [0, 10]);
    setKeyframe(subject, 3, 30);

    const document: MotionDocument = {
      duration: 3,
      fps: 30,
      loop: false,
      areBeziersRestricted: true,
      fadeInTime: 0,
      fadeOutTime: 0,
      tracks: [subject],
      userData: []
    };
    const json = serializeMotion(document);
    expect(json.Meta.TotalSegmentCount).toBe(2);
    expect(json.Curves[0].Segments).toEqual([0, 0, 0, 1, 10, 0, 3, 30]);
  });

  it('honours the requested segment type', () => {
    const subject = track([0, 2], [0, 20]);
    setKeyframe(subject, 1, 10, MotionSegmentType.Stepped);
    expect(subject.keyframes[1].out?.type).toBe(MotionSegmentType.Stepped);
  });
});

describe('removeKeyframe', () => {
  it('removes the keyframe', () => {
    const subject = track([0, 1, 2], [0, 10, 20]);
    removeKeyframe(subject, 1);
    expect(subject.keyframes.map((frame) => frame.time)).toEqual([0, 2]);
  });

  it('strips the outgoing segment from the new final keyframe', () => {
    // A trailing segment with no end point would not serialize.
    const subject = track([0, 1, 2], [0, 10, 20]);
    removeKeyframe(subject, 2);
    expect(subject.keyframes[1].out).toBeUndefined();
  });

  it('ignores an index that is out of range', () => {
    const subject = track([0, 1], [0, 10]);
    removeKeyframe(subject, 9);
    expect(subject.keyframes).toHaveLength(2);
  });
});

describe('moveKeyframe', () => {
  it('moves a keyframe and returns its new index', () => {
    const subject = track([0, 1, 2], [0, 10, 20]);
    // Drag the middle keyframe past the last one.
    const index = moveKeyframe(subject, 1, 3, 15);

    expect(subject.keyframes.map((frame) => frame.time)).toEqual([0, 2, 3]);
    expect(index).toBe(2);
    expect(subject.keyframes[2].value).toBe(15);
  });

  it('keeps the segment chain valid after a reorder', () => {
    const subject = track([0, 1, 2], [0, 10, 20]);
    moveKeyframe(subject, 1, 3, 15);

    // Every keyframe but the last leads somewhere; the last leads nowhere.
    expect(subject.keyframes[0].out).toBeDefined();
    expect(subject.keyframes[1].out).toBeDefined();
    expect(subject.keyframes[2].out).toBeUndefined();
  });

  it('refuses to move a keyframe before time zero', () => {
    const subject = track([1, 2], [10, 20]);
    moveKeyframe(subject, 0, -5, 10);
    expect(subject.keyframes[0].time).toBe(0);
  });

  it('serializes cleanly after a reorder', () => {
    const subject = track([0, 1, 2], [0, 10, 20]);
    moveKeyframe(subject, 1, 3, 15);

    const json = serializeMotion({
      duration: 3,
      fps: 30,
      loop: false,
      areBeziersRestricted: true,
      fadeInTime: 0,
      fadeOutTime: 0,
      tracks: [subject],
      userData: []
    });
    expect(json.Meta.TotalSegmentCount).toBe(2);
    expect(json.Meta.TotalPointCount).toBe(3);
  });
});
