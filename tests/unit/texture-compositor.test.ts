import { describe, expect, it } from 'vitest';
import { TextureCompositor } from '../../src/renderer/core/texture/TextureCompositor';
import type { RegionMask } from '../../src/renderer/core/texture/RegionMasker';
import type { RecolorLayer } from '../../src/renderer/core/texture/TextureCompositor';

/**
 * Runs the real compositor on a known image.
 *
 * jsdom has no WebGL, so these are skipped there — but keeping them beside the
 * other tests documents the contract, and they run wherever a GL context exists.
 */
const hasWebGL = (() => {
  try {
    return typeof OffscreenCanvas !== 'undefined' &&
      new OffscreenCanvas(4, 4).getContext('webgl2') !== null;
  } catch {
    return false;
  }
})();

function fullMask(size: number): RegionMask {
  return {
    textureIndex: 0,
    width: size,
    height: size,
    data: new Uint8Array(size * size).fill(255),
    bounds: { left: 0, top: 0, right: size - 1, bottom: size - 1 }
  };
}

function layer(overrides: Partial<RecolorLayer> = {}): RecolorLayer {
  return {
    id: 'test',
    kind: 'recolor',
    name: 'test',
    visible: true,
    textureIndex: 0,
    hue: 0,
    saturation: 0,
    lightness: 0,
    colorize: { enabled: false, color: '#ffffff', strength: 0 },
    mask: { width: 8, height: 8, bounds: { left: 0, top: 0, right: 7, bottom: 7 }, runs: [] },
    ...overrides
  };
}

describe.skipIf(!hasWebGL)('TextureCompositor', () => {
  it('shifts hue inside the mask', () => {
    const size = 8;
    const source = new OffscreenCanvas(size, size);
    const context = source.getContext('2d')!;
    context.fillStyle = 'rgb(200, 40, 40)';
    context.fillRect(0, 0, size, size);

    const compositor = new TextureCompositor(size, size);
    const result = compositor.applyRecolor(source, layer({ hue: 180 }), fullMask(size));

    const out = result.getContext('2d')!.getImageData(4, 4, 1, 1).data;
    // Red rotated 180° is cyan: blue and green rise, red falls.
    expect(out[3]).toBeGreaterThan(200);
    expect(out[2]).toBeGreaterThan(out[0]);
    compositor.dispose();
  });

  it('leaves pixels outside the mask untouched', () => {
    const size = 8;
    const source = new OffscreenCanvas(size, size);
    const context = source.getContext('2d')!;
    context.fillStyle = 'rgb(200, 40, 40)';
    context.fillRect(0, 0, size, size);

    // Mask only the left half.
    const mask = fullMask(size);
    for (let y = 0; y < size; y += 1) {
      for (let x = size / 2; x < size; x += 1) mask.data[y * size + x] = 0;
    }

    const compositor = new TextureCompositor(size, size);
    const result = compositor.applyRecolor(source, layer({ hue: 180 }), mask);
    const pixels = result.getContext('2d')!.getImageData(0, 0, size, size).data;

    const insideOffset = (4 * size + 1) * 4;
    const outsideOffset = (4 * size + 6) * 4;
    expect(pixels[insideOffset + 2]).toBeGreaterThan(pixels[insideOffset]);
    // Outside the mask the original red must survive exactly.
    expect(pixels[outsideOffset]).toBeGreaterThan(150);
    expect(pixels[outsideOffset + 2]).toBeLessThan(100);
    compositor.dispose();
  });

  it('preserves alpha', () => {
    const size = 8;
    const source = new OffscreenCanvas(size, size);
    const context = source.getContext('2d')!;
    context.fillStyle = 'rgba(200, 40, 40, 0.5)';
    context.fillRect(0, 0, size, size);

    const compositor = new TextureCompositor(size, size);
    const result = compositor.applyRecolor(source, layer({ hue: 90 }), fullMask(size));
    const out = result.getContext('2d')!.getImageData(4, 4, 1, 1).data;

    // Half-transparent in, half-transparent out — a recolour must not change
    // how see-through the artwork is.
    expect(out[3]).toBeGreaterThan(100);
    expect(out[3]).toBeLessThan(160);
    compositor.dispose();
  });

  it('works at the size real models use', () => {
    // The bug this guards against only appeared at texture resolution: a small
    // test passed while 4096² produced an empty result.
    const size = 2048;
    const source = new OffscreenCanvas(size, size);
    const context = source.getContext('2d')!;
    context.fillStyle = 'rgb(200, 40, 40)';
    context.fillRect(0, 0, size, size);

    const compositor = new TextureCompositor(size, size);
    const result = compositor.applyRecolor(source, layer({ hue: 180 }), fullMask(size));
    const out = result.getContext('2d')!.getImageData(size / 2, size / 2, 1, 1).data;

    expect(out[3]).toBeGreaterThan(200);
    expect(out[2]).toBeGreaterThan(out[0]);
    compositor.dispose();
  });
});
