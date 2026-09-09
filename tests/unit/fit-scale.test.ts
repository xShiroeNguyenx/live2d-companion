import { describe, expect, it } from 'vitest';

/**
 * The fit calculation from EditorRuntime.draw, isolated so its geometry can be
 * checked rather than eyeballed.
 *
 * Model space is `widthUnit` wide and `heightUnit` tall; clip space spans -1..1
 * on both axes. The projection scales x by `fitScale` and y by
 * `fitScale * viewportAspect`, and the result must put the whole model inside
 * clip space with no distortion.
 */
function computeFit(
  widthUnit: number,
  heightUnit: number,
  canvasWidth: number,
  canvasHeight: number
): { scaleX: number; scaleY: number } {
  const viewportAspect = canvasWidth / canvasHeight;
  const modelAspect = widthUnit / heightUnit;
  const fitScale =
    modelAspect > viewportAspect
      ? 2 / widthUnit
      : (2 / heightUnit) * (1 / viewportAspect);
  return { scaleX: fitScale, scaleY: fitScale * viewportAspect };
}

/**
 * Half-extents of the model in clip space. Anything above 1 is off screen.
 * Aspect is preserved when clip extent ratio matches the on-screen pixel ratio.
 */
function clipExtents(
  widthUnit: number,
  heightUnit: number,
  canvasWidth: number,
  canvasHeight: number
) {
  const { scaleX, scaleY } = computeFit(widthUnit, heightUnit, canvasWidth, canvasHeight);
  const halfX = (widthUnit / 2) * scaleX;
  const halfY = (heightUnit / 2) * scaleY;
  // Convert clip extents to on-screen pixels to check for distortion.
  const pixelsWide = halfX * canvasWidth;
  const pixelsTall = halfY * canvasHeight;
  return { halfX, halfY, pixelRatio: pixelsWide / pixelsTall };
}

describe('fit scale', () => {
  it('fits a tall model (Hiyori: 2976x4175) inside a landscape viewport', () => {
    // Hiyori's canvas in model units, derived from CanvasWidth/PixelsPerUnit.
    const widthUnit = 2976 / 1024;
    const heightUnit = 4175 / 1024;
    const { halfX, halfY } = clipExtents(widthUnit, heightUnit, 793, 751);

    expect(halfY).toBeCloseTo(1, 5); // height is the binding constraint
    expect(halfX).toBeLessThanOrEqual(1);
    expect(halfX).toBeGreaterThan(0.5); // and it genuinely fills the view
  });

  it('fits a wide model by width instead', () => {
    const { halfX, halfY } = clipExtents(4, 1, 800, 600);
    expect(halfX).toBeCloseTo(1, 5);
    expect(halfY).toBeLessThanOrEqual(1);
  });

  it('preserves the model aspect ratio on screen', () => {
    // A model twice as tall as it is wide must render twice as tall in pixels.
    const { pixelRatio } = clipExtents(2, 4, 793, 751);
    expect(pixelRatio).toBeCloseTo(0.5, 5);
  });

  it('preserves aspect ratio in a portrait viewport too', () => {
    const { pixelRatio } = clipExtents(2, 4, 600, 900);
    expect(pixelRatio).toBeCloseTo(0.5, 5);
  });

  it('never lets the model exceed clip space', () => {
    const cases: Array<[number, number, number, number]> = [
      [2, 2, 800, 600],
      [2, 2, 600, 800],
      [2.9, 4.1, 1400, 700],
      [2.9, 4.1, 400, 1200],
      [6, 1, 1000, 1000]
    ];
    for (const [w, h, cw, ch] of cases) {
      const { halfX, halfY } = clipExtents(w, h, cw, ch);
      expect(halfX).toBeLessThanOrEqual(1.0001);
      expect(halfY).toBeLessThanOrEqual(1.0001);
      // One axis must actually touch the edge, otherwise it is not a tight fit.
      expect(Math.max(halfX, halfY)).toBeCloseTo(1, 4);
    }
  });
});
