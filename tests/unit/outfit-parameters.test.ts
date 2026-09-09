import { describe, expect, it } from 'vitest';
import { detectOutfitParameters, outfitExpression, outfitFileBaseName } from '../../src/renderer/features/pose/outfitParameters';
import type { OpacityProbe, OutfitParameter } from '../../src/renderer/features/pose/outfitParameters';
import type { DrawableInfo, ModelInfo, ParameterInfo } from '../../src/renderer/core/cubism/ModelInfo';

function parameter(index: number, id: string, overrides: Partial<ParameterInfo> = {}): ParameterInfo {
  return {
    index,
    id,
    name: id,
    groupId: '',
    minimum: 0,
    maximum: 1,
    default: 0,
    isBlendShape: false,
    repeats: false,
    ...overrides
  };
}

function drawable(index: number): DrawableInfo {
  return {
    index,
    id: `ArtMesh${index}`,
    textureIndex: 0,
    parentPartIndex: -1,
    vertexCount: 4,
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 }
  };
}

function modelInfo(parameters: ParameterInfo[], meshCount: number): ModelInfo {
  return {
    mocVersion: 2,
    latestSupportedMocVersion: 6,
    canvas: {
      widthPixel: 2048,
      heightPixel: 2048,
      originX: 1024,
      originY: 1024,
      pixelsPerUnit: 1024,
      widthUnit: 2,
      heightUnit: 2
    },
    parameters,
    parts: [],
    drawables: Array.from({ length: meshCount }, (_, i) => drawable(i)),
    parameterGroups: [],
    usesMasking: false,
    hasPartedDrawables: false
  };
}

/**
 * A probe over a hand-written model.
 *
 * `visible` gives, per parameter index, which meshes are lit at value 0 and at
 * value 1 — which is exactly the observation the detector works from, with none
 * of the machinery of a real moc.
 */
function probeOf(
  meshCount: number,
  visible: Record<number, { off: number[]; on: number[] }>
): OpacityProbe {
  return {
    opacitiesAt(parameterIndex, value) {
      const entry = visible[parameterIndex];
      const lit = new Set(entry ? (value === 0 ? entry.off : entry.on) : []);
      return Float32Array.from({ length: meshCount }, (_, i) => (lit.has(i) ? 1 : 0));
    }
  };
}

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, i) => from + i);

describe('detectOutfitParameters', () => {
  it('finds a parameter that swaps one garment for another', () => {
    const info = modelInfo([parameter(0, 'ParamC1')], 100);
    const probe = probeOf(100, { 0: { off: range(0, 20), on: range(20, 40) } });

    const found = detectOutfitParameters(info, probe);

    expect(found).toHaveLength(1);
    expect(found[0].id).toBe('ParamC1');
    expect(found[0].shows).toEqual(range(20, 40));
    expect(found[0].hides).toEqual(range(0, 20));
  });

  it('ignores parameters that move only a few meshes', () => {
    // A blink switches a handful of meshes and must not be offered as an outfit.
    const info = modelInfo([parameter(0, 'ParamEyeLOpen')], 100);
    const probe = probeOf(100, { 0: { off: [1, 2], on: [3, 4] } });

    expect(detectOutfitParameters(info, probe)).toEqual([]);
  });

  it('scales the threshold to the size of the model', () => {
    // The same twelve meshes: noise on a large model, a real garment on a small
    // one. A fixed count could not tell those apart.
    const switched = { 0: { off: range(0, 6), on: range(6, 12) } };

    const large = detectOutfitParameters(modelInfo([parameter(0, 'P')], 1000), probeOf(1000, switched));
    const small = detectOutfitParameters(modelInfo([parameter(0, 'P')], 60), probeOf(60, switched));

    expect(large).toEqual([]);
    expect(small).toHaveLength(1);
  });

  it('skips parameters that are not simple on/off switches', () => {
    const info = modelInfo([parameter(0, 'ParamAngleX', { minimum: -30, maximum: 30 })], 100);
    const probe = probeOf(100, { 0: { off: range(0, 20), on: range(20, 40) } });

    expect(detectOutfitParameters(info, probe)).toEqual([]);
  });

  it('skips blend shapes, which deform artwork rather than swap it', () => {
    const info = modelInfo([parameter(0, 'ParamBlend', { isBlendShape: true })], 100);
    const probe = probeOf(100, { 0: { off: range(0, 20), on: range(20, 40) } });

    expect(detectOutfitParameters(info, probe)).toEqual([]);
  });

  it('puts the parameter that changes the most artwork first', () => {
    const info = modelInfo([parameter(0, 'Small'), parameter(1, 'Large')], 200);
    const probe = probeOf(200, {
      0: { off: range(0, 10), on: range(10, 20) },
      1: { off: range(0, 50), on: range(50, 100) }
    });

    expect(detectOutfitParameters(info, probe).map((entry) => entry.id)).toEqual([
      'Large',
      'Small'
    ]);
  });

  it('reports nothing for a model with no switches at all', () => {
    const info = modelInfo([parameter(0, 'ParamEyeLSmile')], 130);
    const probe = probeOf(130, { 0: { off: range(0, 30), on: range(0, 30) } });

    expect(detectOutfitParameters(info, probe)).toEqual([]);
  });
});

describe('outfitExpression', () => {
  const outfit = (index: number, id: string, name = id): OutfitParameter => ({
    index,
    id,
    name,
    shows: [],
    hides: []
  });

  const all = [outfit(0, 'ParamC0'), outfit(1, 'ParamC1'), outfit(2, 'ParamC2')];

  it('writes the unchosen switches as 0, not just the chosen one as 1', () => {
    // This is what stops two saved outfits stacking: selecting one has to turn
    // the other off, which needs the 0s written explicitly.
    const document = outfitExpression(all, [1]);

    expect(document.Parameters).toEqual([
      { Id: 'ParamC0', Value: 0, Blend: 'Overwrite' },
      { Id: 'ParamC1', Value: 1, Blend: 'Overwrite' },
      { Id: 'ParamC2', Value: 0, Blend: 'Overwrite' }
    ]);
  });

  it('supports an outfit made of several switches at once', () => {
    const document = outfitExpression(all, [0, 2]);
    const on = document.Parameters.filter((entry) => entry.Value === 1).map((e) => e.Id);

    expect(on).toEqual(['ParamC0', 'ParamC2']);
  });

  it('uses Overwrite so a motion cannot add to the switch', () => {
    // An additive blend would sum with a motion curve touching the same
    // parameter and leave the garment half-drawn.
    const document = outfitExpression(all, [0]);

    expect(document.Parameters.every((entry) => entry.Blend === 'Overwrite')).toBe(true);
    expect(document.Type).toBe('Live2D Expression');
  });
});

describe('outfitFileBaseName', () => {
  const named = (id: string, name: string): OutfitParameter => ({
    index: 0,
    id,
    name,
    shows: [],
    hides: []
  });

  it('keeps an ASCII name as it is', () => {
    expect(outfitFileBaseName(named('ParamC1', 'Pyjamas'))).toBe('Pyjamas');
  });

  it('falls back to the id when the name has no filename-safe characters', () => {
    // Authors name parameters in their own script; the id is always ASCII.
    expect(outfitFileBaseName(named('ParamC1', '睡衣'))).toBe('ParamC1');
  });

  it('replaces separators rather than dropping the name', () => {
    expect(outfitFileBaseName(named('ParamC1', 'Summer Dress'))).toBe('Summer_Dress');
  });
});
