import { describe, expect, it } from 'vitest';
import {
  applyChainFeel,
  chainName,
  NEUTRAL_FEEL,
  readChainFeel,
  recomputePhysicsMeta
} from '../../src/renderer/features/physics/physicsOps';
import type { Physics3Json, PhysicsSetting } from '../../src/shared/types/live2d-files';

function setting(overrides: Partial<PhysicsSetting> = {}): PhysicsSetting {
  return {
    Id: 'PhysicsSetting1',
    Input: [
      {
        Source: { Target: 'Parameter', Id: 'ParamAngleX' },
        Weight: 60,
        Type: 'X',
        Reflect: false
      }
    ],
    Output: [
      {
        Destination: { Target: 'Parameter', Id: 'ParamHairFront' },
        VertexIndex: 1,
        Scale: 2,
        Weight: 100,
        Type: 'Angle',
        Reflect: false
      }
    ],
    Vertices: [
      { Position: { X: 0, Y: 0 }, Mobility: 1, Delay: 1, Acceleration: 1, Radius: 0 },
      { Position: { X: 0, Y: 10 }, Mobility: 0.8, Delay: 0.5, Acceleration: 1, Radius: 10 }
    ],
    Normalization: {
      Position: { Minimum: -10, Default: 0, Maximum: 10 },
      Angle: { Minimum: -10, Default: 0, Maximum: 10 }
    },
    ...overrides
  };
}

const clone = <T,>(value: T): T => structuredClone(value);

describe('readChainFeel', () => {
  it('reports neutral for an untouched chain', () => {
    const baseline = setting();
    expect(readChainFeel(clone(baseline), baseline)).toEqual(NEUTRAL_FEEL);
  });

  it('reports more swing when output scale was raised', () => {
    const baseline = setting();
    const edited = clone(baseline);
    edited.Output[0].Scale = 4;
    expect(readChainFeel(edited, baseline).swing).toBeCloseTo(2, 5);
  });

  it('reports more stiffness when mobility was lowered', () => {
    // Lower mobility means the chain follows its anchor more tightly, which is
    // what a user calls "stiffer".
    const baseline = setting();
    const edited = clone(baseline);
    for (const vertex of edited.Vertices) vertex.Mobility /= 2;
    expect(readChainFeel(edited, baseline).stiffness).toBeCloseTo(2, 5);
  });
});

describe('applyChainFeel', () => {
  it('is a no-op at neutral', () => {
    const baseline = setting();
    const edited = clone(baseline);
    applyChainFeel(edited, baseline, NEUTRAL_FEEL);
    expect(edited).toEqual(baseline);
  });

  it('scales the output amount by the swing macro', () => {
    const baseline = setting();
    const edited = clone(baseline);
    applyChainFeel(edited, baseline, { swing: 1.5, stiffness: 1 });
    expect(edited.Output[0].Scale).toBeCloseTo(3, 5);
  });

  it('round-trips through readChainFeel', () => {
    const baseline = setting();
    const edited = clone(baseline);
    applyChainFeel(edited, baseline, { swing: 1.75, stiffness: 1.5 });

    const read = readChainFeel(edited, baseline);
    expect(read.swing).toBeCloseTo(1.75, 3);
    expect(read.stiffness).toBeCloseTo(1.5, 3);
  });

  it('keeps mobility inside the range the simulation expects', () => {
    // Mobility is a blend factor; a value above 1 or at 0 would make the
    // simulation behave in ways the format does not describe.
    const baseline = setting();
    const edited = clone(baseline);

    applyChainFeel(edited, baseline, { swing: 1, stiffness: 0.2 });
    for (const vertex of edited.Vertices) {
      expect(vertex.Mobility).toBeLessThanOrEqual(1);
      expect(vertex.Mobility).toBeGreaterThan(0);
    }

    applyChainFeel(edited, baseline, { swing: 1, stiffness: 3 });
    for (const vertex of edited.Vertices) {
      expect(vertex.Mobility).toBeGreaterThan(0);
    }
  });

  it('always applies relative to the baseline, not the current value', () => {
    // Otherwise dragging the slider back and forth would drift the chain away
    // from where it started.
    const baseline = setting();
    const edited = clone(baseline);

    applyChainFeel(edited, baseline, { swing: 2, stiffness: 1 });
    applyChainFeel(edited, baseline, { swing: 0.5, stiffness: 1 });
    applyChainFeel(edited, baseline, NEUTRAL_FEEL);

    expect(edited.Output[0].Scale).toBeCloseTo(baseline.Output[0].Scale, 5);
  });

  it('clamps an extreme swing rather than writing a wild scale', () => {
    const baseline = setting();
    const edited = clone(baseline);
    applyChainFeel(edited, baseline, { swing: 99, stiffness: 1 });
    expect(edited.Output[0].Scale).toBeCloseTo(baseline.Output[0].Scale * 3, 5);
  });
});

describe('recomputePhysicsMeta', () => {
  it('counts settings, inputs, outputs and vertices', () => {
    const physics: Physics3Json = {
      Version: 3,
      Meta: {
        PhysicsSettingCount: 0,
        TotalInputCount: 0,
        TotalOutputCount: 0,
        VertexCount: 0,
        Fps: 30,
        EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
        PhysicsDictionary: [{ Id: 'PhysicsSetting1', Name: 'Tóc trước' }]
      },
      PhysicsSettings: [setting(), setting({ Id: 'PhysicsSetting2' })]
    };

    recomputePhysicsMeta(physics);

    expect(physics.Meta.PhysicsSettingCount).toBe(2);
    expect(physics.Meta.TotalInputCount).toBe(2);
    expect(physics.Meta.TotalOutputCount).toBe(2);
    expect(physics.Meta.VertexCount).toBe(4);
  });

  it('resolves a chain display name from the dictionary', () => {
    const physics: Physics3Json = {
      Version: 3,
      Meta: {
        PhysicsSettingCount: 1,
        TotalInputCount: 1,
        TotalOutputCount: 1,
        VertexCount: 2,
        EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
        PhysicsDictionary: [{ Id: 'PhysicsSetting1', Name: 'Tóc trước' }]
      },
      PhysicsSettings: [setting()]
    };

    expect(chainName(physics, 'PhysicsSetting1')).toBe('Tóc trước');
    // An id with no dictionary entry still has to display as something.
    expect(chainName(physics, 'PhysicsSetting9')).toBe('PhysicsSetting9');
  });
});
