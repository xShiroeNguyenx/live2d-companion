import { buildRegionMask, type RegionMask } from '../core/texture/RegionMasker';
import {
  deserializeMask,
  serializeMask,
  TextureCompositor,
  type PaintLayer,
  type RecolorLayer,
  type TextureLayer
} from '../core/texture/TextureCompositor';
import { runtimeRef } from './runtimeRef';
import { useSessionStore } from './stores/sessionStore';

/**
 * Owns the pixels behind the texture editor.
 *
 * The layer *definitions* live in a document store (undoable, autosaved); the
 * bitmaps they composite to live here, because ImageBitmaps and canvases cannot
 * go through immer or be structurally cloned into a store without copying
 * megabytes on every keystroke.
 *
 * The split also gives the right performance shape: moving a slider re-composites
 * on the GPU from the original image, which is a few milliseconds, while the
 * document store only sees a small JSON change.
 */
class TextureSession {
  private compositor: TextureCompositor | null = null;
  /** The untouched texture as loaded, per texture index. */
  private readonly originals = new Map<number, OffscreenCanvas>();
  /** Paint strokes as an editable canvas, per texture index. */
  private readonly paintCanvases = new Map<number, OffscreenCanvas>();
  /** Decoded masks, keyed by layer id, so a slider drag does not re-rasterise. */
  private readonly maskCache = new Map<string, RegionMask>();
  private lastComposite = new Map<number, OffscreenCanvas>();

  /**
   * Called once per model load with the decoded texture images.
   *
   * The incoming bitmaps are excluded from the cleanup: `dispose` closes the
   * bitmaps it holds, and if a reload hands back a bitmap this session is
   * already holding, closing it would leave the compositor sourcing from a
   * detached image — which uploads as fully transparent and makes every
   * recolour silently produce nothing.
   */
  setOriginals(images: ImageBitmap[]): void {
    this.compositor?.dispose();
    this.compositor = null;
    this.originals.clear();
    this.paintCanvases.clear();
    this.maskCache.clear();
    this.lastComposite.clear();

    // Copied into canvases rather than kept as ImageBitmaps.
    //
    // The bitmaps handed in here have already been uploaded to the preview's GL
    // context by the model loader. Uploading the same ImageBitmap into a second,
    // unrelated context yields a fully transparent texture — so a recolour would
    // silently produce an empty image. A canvas has no such affinity and can be
    // used as a texture source by any context.
    for (const [index, image] of images.entries()) {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(image, 0, 0);
      this.originals.set(index, canvas);
    }
  }

  getOriginal(textureIndex: number): OffscreenCanvas | undefined {
    return this.originals.get(textureIndex);
  }

  getComposite(textureIndex: number): OffscreenCanvas | undefined {
    return this.lastComposite.get(textureIndex);
  }

  /** The paint canvas for a texture, created on first use. */
  getPaintCanvas(textureIndex: number): OffscreenCanvas | null {
    const original = this.originals.get(textureIndex);
    if (!original) return null;

    let canvas = this.paintCanvases.get(textureIndex);
    if (!canvas) {
      canvas = new OffscreenCanvas(original.width, original.height);
      this.paintCanvases.set(textureIndex, canvas);
    }
    return canvas;
  }

  /**
   * Builds and caches the mask for a recolour layer.
   *
   * Rasterising UV triangles over a 4096² texture is the expensive part of the
   * whole feature, so it happens once per layer rather than once per frame.
   */
  getMask(layer: RecolorLayer): RegionMask | null {
    const cached = this.maskCache.get(layer.id);
    if (cached) return cached;

    const mask = deserializeMask(layer.mask);
    mask.textureIndex = layer.textureIndex;
    this.maskCache.set(layer.id, mask);
    return mask;
  }

  invalidateMask(layerId: string): void {
    this.maskCache.delete(layerId);
  }

  /** Rasterises a fresh mask from the model's UVs for the given drawables. */
  buildMask(textureIndex: number, drawableIndices: number[]): RegionMask | null {
    const runtime = runtimeRef.current;
    const info = useSessionStore.getState().info;
    const original = this.originals.get(textureIndex);
    if (!runtime || !info || !original) return null;

    return buildRegionMask({
      model: runtime.model,
      info,
      drawableIndices,
      textureWidth: original.width,
      textureHeight: original.height
    });
  }

  /**
   * Composites every layer for a texture, in order.
   *
   * Recolour layers each read the previous result, so a stack of adjustments
   * accumulates. Paint goes on last because a stroke is meant to sit on top of
   * whatever colour the layers below produced, not be recoloured by them.
   */
  composite(textureIndex: number, layers: TextureLayer[]): OffscreenCanvas | null {
    const original = this.originals.get(textureIndex);
    if (!original) return null;

    if (!this.compositor) {
      this.compositor = new TextureCompositor(original.width, original.height);
    }

    let current: ImageBitmap | OffscreenCanvas = original;

    for (const layer of layers) {
      if (!layer.visible || layer.textureIndex !== textureIndex) continue;
      if (layer.kind !== 'recolor') continue;

      const mask = this.getMask(layer);
      if (!mask) continue;
      current = this.compositor.applyRecolor(current, layer, mask);
    }

    const output = new OffscreenCanvas(original.width, original.height);
    const context = output.getContext('2d');
    if (!context) return null;
    context.drawImage(current, 0, 0);

    for (const layer of layers) {
      if (!layer.visible || layer.textureIndex !== textureIndex) continue;
      if (layer.kind !== 'paint') continue;
      const canvas = this.paintCanvases.get(textureIndex);
      if (!canvas) continue;
      context.globalAlpha = layer.opacity;
      context.drawImage(canvas, 0, 0);
      context.globalAlpha = 1;
    }

    this.lastComposite.set(textureIndex, output);
    return output;
  }

  /** Pushes a composited texture into the live model, so the preview updates. */
  async uploadToModel(textureIndex: number, composite: OffscreenCanvas): Promise<void> {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    await runtime.replaceTexture(textureIndex, composite);
  }

  /** Encodes a composite as PNG bytes for writing to disk. */
  async encodePng(composite: OffscreenCanvas): Promise<ArrayBuffer> {
    const blob = await composite.convertToBlob({ type: 'image/png' });
    return blob.arrayBuffer();
  }

  dispose(): void {
    this.compositor?.dispose();
    this.compositor = null;
    this.originals.clear();
    this.paintCanvases.clear();
    this.maskCache.clear();
    this.lastComposite.clear();
  }
}

export const textureSession = new TextureSession();

/** A recolour layer with neutral settings, ready to be adjusted. */
export function createRecolorLayer(
  textureIndex: number,
  name: string,
  mask: RegionMask
): RecolorLayer {
  return {
    id: `recolor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'recolor',
    name,
    visible: true,
    textureIndex,
    hue: 0,
    saturation: 0,
    lightness: 0,
    colorize: { enabled: false, color: '#ff8080', strength: 0.6 },
    // Serialized up front so the layer survives a reload without needing the
    // model to be present to re-rasterise it.
    mask: serializeMask(mask)
  };
}

export function createPaintLayer(textureIndex: number, name: string): PaintLayer {
  return {
    id: `paint-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    kind: 'paint',
    name,
    visible: true,
    textureIndex,
    opacity: 1,
    pixels: ''
  };
}
