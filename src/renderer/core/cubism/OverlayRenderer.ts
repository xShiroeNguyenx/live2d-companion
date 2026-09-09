import type { EditorRuntime } from './EditorRuntime';

export interface OverlayHighlight {
  drawableIndex: number;
  label?: string;
  /** Drawn dimmer, for meshes that are merely under the cursor. */
  muted?: boolean;
}

/**
 * Draws editor gizmos on a 2D canvas stacked over the WebGL view.
 *
 * Kept off the GL canvas so gizmos never end up in a screenshot of the model,
 * and so they can be drawn with ordinary 2D primitives (dashed strokes, text)
 * instead of shaders.
 */
export class OverlayRenderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Không tạo được canvas 2D cho overlay');
    this.context = context;
  }

  clear(): void {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Outlines drawables using the same bounding box the runtime hit-tests
   * against, so what the user sees is the actual tap target rather than the
   * tighter shape of the art.
   */
  drawHighlights(runtime: EditorRuntime, highlights: OverlayHighlight[]): void {
    const { context, canvas } = this;
    const ratio = window.devicePixelRatio || 1;

    for (const highlight of highlights) {
      const bounds = runtime.hitTester.getBounds(highlight.drawableIndex);
      if (!bounds) continue;

      // Model space → clip space → device pixels.
      const topLeft = runtime.modelToClip(bounds.left, bounds.top);
      const bottomRight = runtime.modelToClip(bounds.right, bounds.bottom);
      const x = ((topLeft.x + 1) / 2) * canvas.width;
      const y = ((1 - topLeft.y) / 2) * canvas.height;
      const width = ((bottomRight.x - topLeft.x) / 2) * canvas.width;
      const height = ((topLeft.y - bottomRight.y) / 2) * canvas.height;

      context.save();
      context.lineWidth = (highlight.muted ? 1 : 2) * ratio;
      context.strokeStyle = highlight.muted ? '#9aa1ad' : '#6ea8fe';
      context.setLineDash(highlight.muted ? [4 * ratio, 4 * ratio] : []);
      context.strokeRect(x, y, width, height);

      if (highlight.label && !highlight.muted) {
        const fontSize = 12 * ratio;
        context.font = `${fontSize}px "Segoe UI", system-ui, sans-serif`;
        const padding = 4 * ratio;
        const textWidth = context.measureText(highlight.label).width;
        // Keep the label inside the canvas when the box sits near the top edge.
        const labelY = y - fontSize - padding * 2 < 0 ? y + height + padding : y - padding;

        context.fillStyle = 'rgba(27, 29, 35, 0.85)';
        context.fillRect(
          x,
          labelY - fontSize - padding,
          textWidth + padding * 2,
          fontSize + padding * 2
        );
        context.fillStyle = '#6ea8fe';
        context.fillText(highlight.label, x + padding, labelY - padding * 0.5);
      }
      context.restore();
    }
  }

  /**
   * Draws a physics chain as a pendulum: a dot per particle, joined by a line.
   *
   * Physics is otherwise invisible — the user sees hair move but cannot tell
   * which of forty chains is doing it, or where its joints are. Drawing the
   * simulated positions makes the chain being edited unmistakable.
   */
  drawPhysicsChain(
    runtime: EditorRuntime,
    particles: Array<{ x: number; y: number; radius: number }>
  ): void {
    if (particles.length === 0) return;

    const { context, canvas } = this;
    const ratio = window.devicePixelRatio || 1;

    const toScreen = (point: { x: number; y: number }) => {
      const clip = runtime.modelToClip(point.x, point.y);
      return {
        x: ((clip.x + 1) / 2) * canvas.width,
        y: ((1 - clip.y) / 2) * canvas.height
      };
    };

    const points = particles.map(toScreen);

    context.save();
    context.strokeStyle = '#f0b849';
    context.lineWidth = 2 * ratio;
    context.beginPath();
    for (const [index, point] of points.entries()) {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();

    for (const [index, point] of points.entries()) {
      context.beginPath();
      context.arc(point.x, point.y, (index === 0 ? 5 : 4) * ratio, 0, Math.PI * 2);
      // The root is drawn hollow: it is the anchor the chain hangs from, not a
      // joint that moves.
      if (index === 0) {
        context.strokeStyle = '#f0b849';
        context.lineWidth = 2 * ratio;
        context.stroke();
      } else {
        context.fillStyle = '#f0b849';
        context.fill();
      }
    }
    context.restore();
  }

  /** Matches the overlay's backing store to its on-screen size. */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }
}
