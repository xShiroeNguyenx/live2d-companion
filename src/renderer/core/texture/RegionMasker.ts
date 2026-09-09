import type { CubismModel } from '@framework/model/cubismmodel';
import { pointInTriangle } from '../cubism/HitTester';
import type { ModelInfo } from '../cubism/ModelInfo';

/**
 * Turns a selection of drawables into a mask over their texture.
 *
 * This is what makes recolouring usable by someone who cannot draw. The user
 * clicks the jacket on the model; we look up which mesh that is, read its UV
 * triangles out of the Core, and rasterise them into texture space. The result
 * is a stencil that confines every later colour change to exactly the artwork
 * that mesh uses — no lasso, no magic wand, no bleeding onto the skin.
 *
 * The alternative (an HSL slider over the whole PNG) would change hair and skin
 * along with the clothes, which is why it was rejected.
 */
export interface RegionMask {
  /** Texture this mask belongs to, as indexed by model3.json. */
  textureIndex: number;
  width: number;
  height: number;
  /** 255 inside the region, 0 outside. One byte per pixel. */
  data: Uint8Array;
  /** Tight bounds of the covered area, for skipping empty work. */
  bounds: { left: number; top: number; right: number; bottom: number };
}

export interface MaskRequest {
  model: CubismModel;
  info: ModelInfo;
  /** Drawable indices to include. All must share one texture. */
  drawableIndices: number[];
  textureWidth: number;
  textureHeight: number;
  /**
   * Grows the mask outwards by this many pixels.
   *
   * Live2D art is drawn with anti-aliased edges that spill a pixel or two past
   * the mesh, so a mask cut exactly at the triangle boundary leaves a fringe of
   * the original colour. Two pixels of dilation covers it.
   */
  featherPixels?: number;
}

const DEFAULT_FEATHER = 2;

/** Builds a mask covering the given drawables in their texture. */
export function buildRegionMask(request: MaskRequest): RegionMask | null {
  const { model, info, drawableIndices, textureWidth, textureHeight } = request;
  if (drawableIndices.length === 0) return null;

  const textureIndex = info.drawables[drawableIndices[0]]?.textureIndex ?? 0;
  const data = new Uint8Array(textureWidth * textureHeight);

  let left = textureWidth;
  let top = textureHeight;
  let right = 0;
  let bottom = 0;
  let covered = false;

  for (const drawableIndex of drawableIndices) {
    // A mask spans one texture; a drawable on another texture would be painted
    // at meaningless coordinates.
    if (info.drawables[drawableIndex]?.textureIndex !== textureIndex) continue;

    const uvs = model.getDrawableVertexUvs(drawableIndex);
    const indices = model.getDrawableVertexIndices(drawableIndex);

    for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
      const a = indices[triangle] * 2;
      const b = indices[triangle + 1] * 2;
      const c = indices[triangle + 2] * 2;

      // UVs run 0..1 with the origin at the bottom-left, while image data runs
      // top-down — hence the flip on y.
      const ax = uvs[a] * textureWidth;
      const ay = (1 - uvs[a + 1]) * textureHeight;
      const bx = uvs[b] * textureWidth;
      const by = (1 - uvs[b + 1]) * textureHeight;
      const cx = uvs[c] * textureWidth;
      const cy = (1 - uvs[c + 1]) * textureHeight;

      const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
      const maxX = Math.min(textureWidth - 1, Math.ceil(Math.max(ax, bx, cx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
      const maxY = Math.min(textureHeight - 1, Math.ceil(Math.max(ay, by, cy)));

      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          // Sample at the pixel centre so a triangle edge lands consistently.
          if (!pointInTriangle(x + 0.5, y + 0.5, ax, ay, bx, by, cx, cy)) continue;
          data[y * textureWidth + x] = 255;
          covered = true;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
  }

  if (!covered) return null;

  const feather = request.featherPixels ?? DEFAULT_FEATHER;
  if (feather > 0) {
    dilate(data, textureWidth, textureHeight, feather, {
      left,
      top,
      right,
      bottom
    });
    left = Math.max(0, left - feather);
    top = Math.max(0, top - feather);
    right = Math.min(textureWidth - 1, right + feather);
    bottom = Math.min(textureHeight - 1, bottom + feather);
  }

  return {
    textureIndex,
    width: textureWidth,
    height: textureHeight,
    data,
    bounds: { left, top, right, bottom }
  };
}

/**
 * Grows the mask by `radius` pixels, in place.
 *
 * Two separable passes rather than a square kernel: for a 4096² texture the
 * difference is a few milliseconds versus a visible stall.
 */
function dilate(
  data: Uint8Array,
  width: number,
  height: number,
  radius: number,
  bounds: { left: number; top: number; right: number; bottom: number }
): void {
  const left = Math.max(0, bounds.left - radius);
  const right = Math.min(width - 1, bounds.right + radius);
  const top = Math.max(0, bounds.top - radius);
  const bottom = Math.min(height - 1, bounds.bottom + radius);

  const horizontal = new Uint8Array(data.length);
  for (let y = top; y <= bottom; y += 1) {
    const row = y * width;
    for (let x = left; x <= right; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius && value === 0; offset += 1) {
        const sample = x + offset;
        if (sample < 0 || sample >= width) continue;
        if (data[row + sample] > 0) value = 255;
      }
      horizontal[row + x] = value;
    }
  }

  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius && value === 0; offset += 1) {
        const sample = y + offset;
        if (sample < 0 || sample >= height) continue;
        if (horizontal[sample * width + x] > 0) value = 255;
      }
      data[y * width + x] = value;
    }
  }
}

/**
 * Every drawable belonging to a part, restricted to one texture.
 *
 * Selecting by part is how the user thinks ("the jacket"), but a part can span
 * several meshes and, on a multi-texture model, several textures — so the caller
 * has to pick which texture to work on.
 */
export function drawablesForPart(
  info: ModelInfo,
  partIndices: Iterable<number>
): Map<number, number[]> {
  const wanted = new Set(partIndices);
  const byTexture = new Map<number, number[]>();

  for (const drawable of info.drawables) {
    if (!wanted.has(drawable.parentPartIndex)) continue;
    const list = byTexture.get(drawable.textureIndex);
    if (list) list.push(drawable.index);
    else byTexture.set(drawable.textureIndex, [drawable.index]);
  }
  return byTexture;
}
