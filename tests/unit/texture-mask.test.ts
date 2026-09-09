import { describe, expect, it } from 'vitest';
import {
  deserializeMask,
  hexToRgb,
  serializeMask
} from '../../src/renderer/core/texture/TextureCompositor';
import { drawablesForPart } from '../../src/renderer/core/texture/RegionMasker';
import type { RegionMask } from '../../src/renderer/core/texture/RegionMasker';
import type { DrawableInfo, ModelInfo } from '../../src/renderer/core/cubism/ModelInfo';

function mask(width: number, height: number, fill: (x: number, y: number) => boolean): RegionMask {
  const data = new Uint8Array(width * height);
  let left = width;
  let top = height;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!fill(x, y)) continue;
      data[y * width + x] = 255;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return { textureIndex: 0, width, height, data, bounds: { left, top, right, bottom } };
}

describe('mask serialization', () => {
  it('round-trips a simple region', () => {
    const original = mask(16, 16, (x, y) => x >= 4 && x < 12 && y >= 4 && y < 12);
    const restored = deserializeMask(serializeMask(original));

    expect(restored.width).toBe(original.width);
    expect(restored.height).toBe(original.height);
    expect(Array.from(restored.data)).toEqual(Array.from(original.data));
  });

  it('round-trips a mask that starts filled at pixel zero', () => {
    // The encoding starts with an "off" run, so a mask beginning at index 0 has
    // to emit a leading zero-length run or everything shifts by one.
    const original = mask(8, 8, (x, y) => x < 3 && y < 3);
    const restored = deserializeMask(serializeMask(original));
    expect(Array.from(restored.data)).toEqual(Array.from(original.data));
  });

  it('round-trips a fully covered mask', () => {
    const original = mask(8, 8, () => true);
    const restored = deserializeMask(serializeMask(original));
    expect(Array.from(restored.data)).toEqual(Array.from(original.data));
  });

  it('round-trips an empty mask', () => {
    const original = mask(8, 8, () => false);
    const restored = deserializeMask(serializeMask(original));
    expect(restored.data.every((value) => value === 0)).toBe(true);
  });

  it('compresses a large uniform region to very few runs', () => {
    // The point of run-length encoding here: a jacket mask on a 2048 texture
    // must not bloat the project file.
    const original = mask(512, 512, (x, y) => x >= 100 && x < 400 && y >= 100 && y < 400);
    const serialized = serializeMask(original);
    expect(serialized.runs.length).toBeLessThan(original.data.length / 100);
  });
});

describe('drawablesForPart', () => {
  const drawables: DrawableInfo[] = [
    { index: 0, id: 'Jacket', textureIndex: 0, parentPartIndex: 1, vertexCount: 4 },
    { index: 1, id: 'JacketTrim', textureIndex: 0, parentPartIndex: 1, vertexCount: 4 },
    { index: 2, id: 'Buttons', textureIndex: 1, parentPartIndex: 1, vertexCount: 4 },
    { index: 3, id: 'Face', textureIndex: 0, parentPartIndex: 2, vertexCount: 4 }
  ];

  const info = {
    parts: [],
    drawables,
    parameters: [],
    parameterGroups: [],
    usesMasking: false,
    mocVersion: 5,
    latestSupportedMocVersion: 6,
    canvas: {
      widthPixel: 2048,
      heightPixel: 2048,
      originX: 1024,
      originY: 1024,
      pixelsPerUnit: 1024,
      widthUnit: 2,
      heightUnit: 2
    }
  } as ModelInfo;

  it('groups a part drawables by the texture they live on', () => {
    // A part can span textures, and a mask only makes sense within one.
    const byTexture = drawablesForPart(info, [1]);
    expect(byTexture.get(0)).toEqual([0, 1]);
    expect(byTexture.get(1)).toEqual([2]);
  });

  it('excludes drawables from other parts', () => {
    const byTexture = drawablesForPart(info, [1]);
    expect(byTexture.get(0)).not.toContain(3);
  });

  it('returns nothing for a part that draws nothing', () => {
    expect(drawablesForPart(info, [99]).size).toBe(0);
  });
});

describe('hexToRgb', () => {
  it('parses a six-digit colour', () => {
    expect(hexToRgb('#ff8040')).toEqual({ r: 1, g: 128 / 255, b: 64 / 255 });
  });

  it('expands a three-digit shorthand', () => {
    expect(hexToRgb('#f80')).toEqual({ r: 1, g: 136 / 255, b: 0 });
  });

  it('falls back to white on nonsense rather than producing NaN', () => {
    // NaN would reach a shader uniform and paint the region black.
    expect(hexToRgb('not a colour')).toEqual({ r: 1, g: 1, b: 1 });
  });
});
