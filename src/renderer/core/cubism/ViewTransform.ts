import { CubismMatrix44 } from '@framework/math/cubismmatrix44';

/**
 * Camera for the preview canvas: zoom about the cursor and pan by dragging.
 *
 * Kept separate from the framework's CubismViewMatrix because that class clamps
 * to a screen rect designed for a fixed-size player window, whereas an editor
 * wants free navigation and a "fit" command it controls itself.
 */
export class ViewTransform {
  private scaleValue = 1;
  private translateXValue = 0;
  private translateYValue = 0;
  private readonly matrix44 = new CubismMatrix44();

  static readonly minScale = 0.1;
  static readonly maxScale = 8;

  get matrix(): CubismMatrix44 {
    this.matrix44.loadIdentity();
    this.matrix44.scale(this.scaleValue, this.scaleValue);
    this.matrix44.translateRelative(this.translateXValue, this.translateYValue);
    return this.matrix44;
  }

  get scale(): number {
    return this.scaleValue;
  }

  /**
   * Zoom keeping the point under the cursor fixed.
   *
   * @param clipX Cursor x in clip space, -1 to 1.
   * @param clipY Cursor y in clip space, -1 to 1 with +1 at the top.
   * @param factor Multiplier to apply to the current scale.
   */
  zoomAt(clipX: number, clipY: number, factor: number): void {
    const next = Math.max(
      ViewTransform.minScale,
      Math.min(ViewTransform.maxScale, this.scaleValue * factor)
    );
    if (next === this.scaleValue) return;

    // The transform is clip = scale * (model + translate). Solving that for the
    // model point under the cursor and requiring it to stay put across the
    // scale change gives this translation adjustment.
    this.translateXValue += clipX / next - clipX / this.scaleValue;
    this.translateYValue += clipY / next - clipY / this.scaleValue;
    this.scaleValue = next;
  }

  /** Pan by a delta expressed in clip-space units. */
  pan(deltaClipX: number, deltaClipY: number): void {
    this.translateXValue += deltaClipX / this.scaleValue;
    this.translateYValue += deltaClipY / this.scaleValue;
  }

  /** Frame the whole model with a small margin. */
  fit(): void {
    this.scaleValue = 1;
    this.translateXValue = 0;
    this.translateYValue = 0;
  }

  setScale(scale: number): void {
    this.scaleValue = Math.max(
      ViewTransform.minScale,
      Math.min(ViewTransform.maxScale, scale)
    );
  }
}
