import { describe, expect, it } from 'vitest';

/**
 * The save/restore contract of `EditorRuntime.probeOpacities`, isolated because
 * the method itself needs a WebGL context and a real moc.
 *
 * Probing means driving the model to a value the user did not ask for, reading
 * what happens, and putting everything back. Outfit detection calls it once per
 * candidate parameter in a tight loop, so "put everything back" has to hold
 * across a whole sweep, not just one call.
 *
 * This is a regression test. The first version relied on the next frame's
 * `loadParameters()` to undo the damage, which is wrong twice over: that
 * restores the *saved* buffer rather than the live array, and the sweep runs to
 * completion before any frame happens. The result was that opening a model
 * flattened whatever pose the user was holding — the smoke test caught it as
 * "capturing a pose did not create an expression", because by capture time
 * there was no pose left to capture.
 */

/** The parts of the Cubism model this logic touches. */
interface FakeModel {
  /** The live parameter array the renderer reads. */
  values: Float32Array;
  /** What `saveParameters()` last stored; `loadParameters()` restores this. */
  saved: Float32Array;
  defaults: Float32Array;
}

function makeModel(defaults: number[], live: number[], saved?: number[]): FakeModel {
  return {
    values: Float32Array.from(live),
    saved: Float32Array.from(saved ?? defaults),
    defaults: Float32Array.from(defaults)
  };
}

/**
 * The fixed implementation: snapshot the live array, drive it, put it back.
 *
 * Returns a stand-in for the opacity readout, which the real method computes
 * from the model after `update()`.
 */
function probe(model: FakeModel, parameterIndex: number, value: number): number[] {
  const snapshot = Float32Array.from(model.values);

  model.values.set(model.defaults);
  model.values[parameterIndex] = value;
  const observed = [...model.values];

  model.values.set(snapshot);
  return observed;
}

/** What the original did — kept so the test states what it is guarding against. */
function probeViaLoadParameters(model: FakeModel, parameterIndex: number, value: number): void {
  model.values.set(model.defaults);
  model.values[parameterIndex] = value;
  model.values.set(model.saved);
}

describe('probeOpacities save/restore', () => {
  it('leaves the live parameters exactly as it found them', () => {
    const model = makeModel([0, 0, 0], [30, 0.5, -12]);

    probe(model, 1, 1);

    expect([...model.values]).toEqual([30, 0.5, -12]);
  });

  it('still reads what the probed parameter does', () => {
    const model = makeModel([0, 0, 0], [30, 0.5, -12]);

    const observed = probe(model, 1, 1);

    // Everything at its default except the one under test.
    expect(observed).toEqual([0, 1, 0]);
  });

  it('survives a full sweep, which is how outfit detection calls it', () => {
    const model = makeModel([0, 0, 0], [30, 0.5, -12]);

    for (let index = 0; index < 3; index += 1) {
      probe(model, index, 0);
      probe(model, index, 1);
    }

    expect([...model.values]).toEqual([30, 0.5, -12]);
  });

  it('restoring from the saved buffer loses the pose — the original bug', () => {
    // The saved buffer holds the previous frame's authored base, which is not
    // the same as the live array mid-frame. A user holding a slider has moved
    // the live values past what was last saved.
    const model = makeModel([0, 0, 0], [30, 0.5, -12], [0, 0, 0]);

    probeViaLoadParameters(model, 1, 1);

    expect([...model.values]).not.toEqual([30, 0.5, -12]);
    expect([...model.values]).toEqual([0, 0, 0]);
  });
});
