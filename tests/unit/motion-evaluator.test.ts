import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { CubismMotion } from '@framework/motion/cubismmotion';
import { CubismMoc } from '@framework/model/cubismmoc';
import { CubismMotionQueueManager } from '@framework/motion/cubismmotionqueuemanager';
import { CubismFramework } from '@framework/live2dcubismframework';
import type { CubismModel } from '@framework/model/cubismmodel';
import type { Motion3Json } from '@shared/types/live2d-files';
import { parseMotion, serializeMotion } from '../../src/renderer/core/motion/MotionSerializer';
import { evaluateTrack } from '../../src/renderer/core/motion/MotionEvaluator';

/**
 * Clamps a raw curve value the way the framework does on its way into the model.
 *
 * The evaluator deliberately returns the unclamped value: a bezier whose handle
 * overshoots its endpoints genuinely goes past them, and the timeline has to draw
 * that. The clamp belongs to writing the value into a parameter, which is where
 * the framework applies it — so a parity check must clamp too, or it compares a
 * curve against a parameter.
 */
function clampToParameter(model: CubismModel, id: string, value: number): number {
  const index = model.getParameterIndex(CubismFramework.getIdManager().getId(id));
  if (index < 0) return value;
  const minimum = model.getParameterMinimumValue(index);
  const maximum = model.getParameterMaximumValue(index);
  return Math.min(Math.max(value, minimum), maximum);
}

const SAMPLE_DIR = resolve('resources/sample-models/Hiyori');

function readMotion(name: string): Motion3Json {
  return JSON.parse(
    readFileSync(resolve(SAMPLE_DIR, 'motions', name), 'utf8')
  ) as Motion3Json;
}

function toArrayBuffer(json: unknown): ArrayBuffer {
  const encoded = new TextEncoder().encode(JSON.stringify(json));
  return encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength
  ) as ArrayBuffer;
}

/**
 * Plays a motion through the framework and reads back what it wrote.
 *
 * This is the reference the editor's evaluator has to match. Rather than
 * trusting the framework's queue timing, the motion is driven to an absolute
 * time by giving the queue entry a known start point, so both sides are asked
 * for the same instant.
 */
function frameworkValuesAt(
  json: Motion3Json,
  model: CubismModel,
  time: number
): Map<string, number> {
  const buffer = toArrayBuffer(json);
  const motion = CubismMotion.create(buffer, buffer.byteLength);
  const manager = new CubismMotionQueueManager();

  // Reset every parameter first so a leftover value cannot be mistaken for one
  // the motion actually wrote.
  for (let index = 0; index < model.getParameterCount(); index += 1) {
    model.setParameterValueByIndex(index, 0);
  }
  model.saveParameters();

  // CubismMotion leaves these null until a model setting supplies them, and
  // doUpdateParameters dereferences them unconditionally. A player always goes
  // through CubismUserModel, which sets them; a bare motion has to be told.
  motion.setEffectIds([], []);

  manager.startMotion(motion, false);
  // Two updates: the first establishes the entry's start time, the second
  // advances to the instant under test. Fades are disabled below so the second
  // update lands on the raw curve value.
  motion.setFadeInTime(0);
  motion.setFadeOutTime(0);
  manager.doUpdateMotion(model, 0);
  manager.doUpdateMotion(model, time);

  const values = new Map<string, number>();
  const idManager = CubismFramework.getIdManager();
  for (const curve of json.Curves) {
    if (curve.Target !== 'Parameter') continue;
    values.set(curve.Id, model.getParameterValueById(idManager.getId(curve.Id)));
  }
  return values;
}

describe('MotionEvaluator parity with CubismMotion', () => {
  let moc: CubismMoc;
  let model: CubismModel;

  beforeAll(() => {
    const mocBytes = readFileSync(resolve(SAMPLE_DIR, 'Hiyori.moc3'));
    const buffer = mocBytes.buffer.slice(
      mocBytes.byteOffset,
      mocBytes.byteOffset + mocBytes.byteLength
    ) as ArrayBuffer;
    moc = CubismMoc.create(buffer, false);
    expect(moc).not.toBeNull();
    model = moc.createModel();
    expect(model).not.toBeNull();
  });

  // Hiyori's motions ship AreBeziersRestricted: false, so this also covers the
  // Cardano path — the one that would be easy to get subtly wrong.
  const motionNames = ['Hiyori_m01.motion3.json', 'Hiyori_m05.motion3.json'];

  for (const name of motionNames) {
    it(`matches the framework across ${name}`, () => {
      const json = readMotion(name);
      const document = parseMotion(json);
      const duration = json.Meta.Duration;

      let worst = 0;
      let worstAt = '';
      let comparisons = 0;

      // Sample densely, including exactly on keyframe boundaries where the two
      // implementations are most likely to disagree.
      for (let step = 0; step <= 60; step += 1) {
        const time = (duration * step) / 60;
        const reference = frameworkValuesAt(json, model, time);

        for (const track of document.tracks) {
          if (track.target !== 'Parameter') continue;
          const expected = reference.get(track.id);
          if (expected === undefined) continue;

          const actual = clampToParameter(
            model,
            track.id,
            evaluateTrack(track, time, document.areBeziersRestricted)
          );
          const error = Math.abs(actual - expected);
          comparisons += 1;
          if (error > worst) {
            worst = error;
            worstAt = `${track.id} @ ${time.toFixed(3)}s (ours ${actual}, framework ${expected})`;
          }
        }
      }

      expect(comparisons).toBeGreaterThan(500);
      expect(worst, `largest disagreement: ${worstAt}`).toBeLessThan(1e-4);
    });
  }

  it('matches the framework on keyframe times exactly', () => {
    const json = readMotion('Hiyori_m01.motion3.json');
    const document = parseMotion(json);

    // A curve with beziers, sampled at its own keyframe times.
    const track = document.tracks.find(
      (candidate) => candidate.target === 'Parameter' && candidate.keyframes.length > 4
    );
    expect(track).toBeDefined();

    let worst = 0;
    for (const keyframe of track!.keyframes) {
      const reference = frameworkValuesAt(json, model, keyframe.time);
      const expected = reference.get(track!.id);
      if (expected === undefined) continue;
      const actual = clampToParameter(
        model,
        track!.id,
        evaluateTrack(track!, keyframe.time, document.areBeziersRestricted)
      );
      worst = Math.max(worst, Math.abs(actual - expected));
    }
    expect(worst).toBeLessThan(1e-4);
  });

  it('matches the framework for a motion authored with restricted beziers', () => {
    // The sample motions are unrestricted; flipping the flag exercises the
    // parametric path against the framework's own restricted evaluation.
    const json = readMotion('Hiyori_m01.motion3.json');
    json.Meta.AreBeziersRestricted = true;

    const document = parseMotion(json);
    expect(document.areBeziersRestricted).toBe(true);

    let worst = 0;
    for (let step = 0; step <= 40; step += 1) {
      const time = (json.Meta.Duration * step) / 40;
      const reference = frameworkValuesAt(json, model, time);
      for (const track of document.tracks) {
        if (track.target !== 'Parameter') continue;
        const expected = reference.get(track.id);
        if (expected === undefined) continue;
        worst = Math.max(
          worst,
          Math.abs(
            clampToParameter(model, track.id, evaluateTrack(track, time, true)) -
              expected
          )
        );
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });
});

describe('MotionSerializer round trip', () => {
  const motionNames = [
    'Hiyori_m01.motion3.json',
    'Hiyori_m02.motion3.json',
    'Hiyori_m05.motion3.json',
    'Hiyori_m10.motion3.json'
  ];

  for (const name of motionNames) {
    it(`preserves every curve of ${name}`, () => {
      const original = readMotion(name);
      const written = serializeMotion(parseMotion(original));

      expect(written.Curves).toHaveLength(original.Curves.length);
      for (const [index, curve] of original.Curves.entries()) {
        expect(written.Curves[index].Target).toBe(curve.Target);
        expect(written.Curves[index].Id).toBe(curve.Id);
        // The flat segment arrays must come back byte-for-byte identical, since
        // any drift would change how the motion plays.
        expect(written.Curves[index].Segments).toEqual(curve.Segments);
      }
    });

    it(`recomputes the same Meta counts as ${name} declares`, () => {
      const original = readMotion(name);
      const written = serializeMotion(parseMotion(original));

      // The sample files come from Cubism Editor, so agreeing with them is
      // evidence the counting rules are right.
      expect(written.Meta.CurveCount).toBe(original.Meta.CurveCount);
      expect(written.Meta.TotalSegmentCount).toBe(original.Meta.TotalSegmentCount);
      expect(written.Meta.TotalPointCount).toBe(original.Meta.TotalPointCount);
      expect(written.Meta.UserDataCount).toBe(original.Meta.UserDataCount);
      expect(written.Meta.Fps).toBe(original.Meta.Fps);
      expect(written.Meta.Loop).toBe(original.Meta.Loop);
      expect(written.Meta.AreBeziersRestricted).toBe(
        original.Meta.AreBeziersRestricted
      );
    });
  }

  it('is stable across a second round trip', () => {
    const once = serializeMotion(parseMotion(readMotion('Hiyori_m01.motion3.json')));
    const twice = serializeMotion(parseMotion(once));
    expect(twice).toEqual(once);
  });

  it('produces a motion the framework can load', () => {
    // The strongest check on the writer: the real loader accepts the output.
    const written = serializeMotion(parseMotion(readMotion('Hiyori_m01.motion3.json')));
    const buffer = toArrayBuffer(written);
    const motion = CubismMotion.create(buffer, buffer.byteLength);
    expect(motion).not.toBeNull();
    expect(motion.getDuration()).toBeCloseTo(written.Meta.Duration, 3);
  });
});
