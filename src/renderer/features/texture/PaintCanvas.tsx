import { useEffect, useRef, useState } from 'react';
import { textureSession } from '../../document/textureSession';
import type { TextureLayer } from '../../core/texture/TextureCompositor';

export interface PaintCanvasProps {
  textureIndex: number;
  layers: TextureLayer[];
  onStrokeEnd(): void;
  onAddLayer(): void;
}

interface Brush {
  size: number;
  color: string;
  opacity: number;
  hardness: number;
  eraser: boolean;
}

/**
 * A brush that paints directly onto the texture, shown in texture space.
 *
 * Texture space rather than on the model, because Live2D art is drawn flat and
 * then deformed: painting on the deformed view would need an inverse mapping per
 * stroke sample and would smear whenever the model moved. Seeing the atlas is
 * also how the user finds the blank area beside a sleeve to draw an emblem on.
 *
 * The aim is "add a heart on the cheek", not to replace Photoshop — for anything
 * bigger the flattened PNG is right there in the workspace.
 */
export function PaintCanvas({
  textureIndex,
  layers,
  onStrokeEnd,
  onAddLayer
}: PaintCanvasProps) {
  const viewRef = useRef<HTMLCanvasElement>(null);
  const [brush, setBrush] = useState<Brush>({
    size: 24,
    color: '#ff5577',
    opacity: 1,
    hardness: 0.8,
    eraser: false
  });

  const hasPaintLayer = layers.some(
    (layer) => layer.kind === 'paint' && layer.textureIndex === textureIndex
  );

  // Redraw the working view whenever the composite changes underneath.
  useEffect(() => {
    const view = viewRef.current;
    const context = view?.getContext('2d');
    if (!view || !context) return;

    const source =
      textureSession.getComposite(textureIndex) ?? textureSession.getOriginal(textureIndex);
    if (!source) return;

    const ratio = window.devicePixelRatio || 1;
    const width = view.clientWidth * ratio;
    const height = view.clientHeight * ratio;
    if (view.width !== width || view.height !== height) {
      view.width = width;
      view.height = height;
    }

    context.clearRect(0, 0, view.width, view.height);
    // Checkerboard behind the art, so transparent regions read as transparent
    // rather than as black paint.
    drawCheckerboard(context, view.width, view.height, 8 * ratio);

    const scale = Math.min(view.width / source.width, view.height / source.height);
    const drawWidth = source.width * scale;
    const drawHeight = source.height * scale;
    context.drawImage(
      source,
      (view.width - drawWidth) / 2,
      (view.height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
  }, [textureIndex, layers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !hasPaintLayer) return;

    /** Maps a pointer position onto texture pixels. */
    const toTexture = (event: PointerEvent): { x: number; y: number } | null => {
      const source = textureSession.getOriginal(textureIndex);
      if (!source) return null;

      const rect = view.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const canvasWidth = rect.width * ratio;
      const canvasHeight = rect.height * ratio;
      const scale = Math.min(canvasWidth / source.width, canvasHeight / source.height);
      const drawWidth = source.width * scale;
      const drawHeight = source.height * scale;
      const offsetX = (canvasWidth - drawWidth) / 2;
      const offsetY = (canvasHeight - drawHeight) / 2;

      const px = (event.clientX - rect.left) * ratio - offsetX;
      const py = (event.clientY - rect.top) * ratio - offsetY;
      if (px < 0 || py < 0 || px > drawWidth || py > drawHeight) return null;

      return { x: px / scale, y: py / scale };
    };

    let painting = false;
    let last: { x: number; y: number } | null = null;

    const stroke = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
      const canvas = textureSession.getPaintCanvas(textureIndex);
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;

      context.save();
      // Erasing punches through the paint layer only; the artwork below is
      // untouched, which is what makes the whole stack non-destructive.
      context.globalCompositeOperation = brush.eraser ? 'destination-out' : 'source-over';
      context.globalAlpha = brush.opacity;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = brush.size;

      if (brush.hardness >= 0.99 || brush.eraser) {
        context.strokeStyle = brush.color;
      } else {
        // A soft brush is a radial gradient along the stroke; drawn per segment
        // so the falloff follows the cursor rather than the whole path.
        const gradient = context.createRadialGradient(
          to.x,
          to.y,
          (brush.size / 2) * brush.hardness,
          to.x,
          to.y,
          brush.size / 2
        );
        gradient.addColorStop(0, brush.color);
        gradient.addColorStop(1, 'transparent');
        context.strokeStyle = gradient;
      }

      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
      context.restore();
    };

    const onPointerDown = (event: PointerEvent): void => {
      const point = toTexture(event);
      if (!point) return;
      painting = true;
      last = point;
      // A click with no drag should still leave a dot.
      stroke(point, point);
      view.setPointerCapture(event.pointerId);
      onStrokeEnd();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!painting) return;
      const point = toTexture(event);
      if (!point || !last) return;
      stroke(last, point);
      last = point;
      onStrokeEnd();
    };

    const onPointerUp = (event: PointerEvent): void => {
      painting = false;
      last = null;
      if (view.hasPointerCapture(event.pointerId)) {
        view.releasePointerCapture(event.pointerId);
      }
    };

    view.addEventListener('pointerdown', onPointerDown);
    view.addEventListener('pointermove', onPointerMove);
    view.addEventListener('pointerup', onPointerUp);
    return () => {
      view.removeEventListener('pointerdown', onPointerDown);
      view.removeEventListener('pointermove', onPointerMove);
      view.removeEventListener('pointerup', onPointerUp);
    };
  }, [textureIndex, brush, hasPaintLayer, onStrokeEnd]);

  return (
    <div className="paint">
      {!hasPaintLayer ? (
        <div className="paint__empty">
          <p className="panel__hint">
            Tạo một lớp vẽ để bắt đầu. Nét vẽ nằm trên lớp riêng, không đụng vào ảnh gốc.
          </p>
          <button type="button" className="button" onClick={onAddLayer}>
            Tạo lớp vẽ
          </button>
        </div>
      ) : (
        <>
          <div className="paint__tools">
            <label className="paint__tool">
              <input
                type="color"
                value={brush.color}
                onChange={(event) => setBrush({ ...brush, color: event.target.value })}
              />
            </label>
            <label className="paint__tool">
              Cỡ
              <input
                type="range"
                min={2}
                max={200}
                value={brush.size}
                onChange={(event) =>
                  setBrush({ ...brush, size: Number(event.target.value) })
                }
              />
              <span className="paint__value">{brush.size}</span>
            </label>
            <label className="paint__tool">
              Mềm
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={brush.hardness}
                onChange={(event) =>
                  setBrush({ ...brush, hardness: Number(event.target.value) })
                }
              />
            </label>
            <label className="paint__tool">
              <input
                type="checkbox"
                checked={brush.eraser}
                onChange={(event) => setBrush({ ...brush, eraser: event.target.checked })}
              />
              Tẩy
            </label>
          </div>

          <canvas ref={viewRef} className="paint__canvas" />
          <p className="panel__hint">
            Đây là ảnh texture trải phẳng. Vẽ lên đúng chỗ nào thì phần đó trên model đổi
            theo — kéo thử để tìm vị trí.
          </p>
        </>
      )}
    </div>
  );
}

function drawCheckerboard(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  size: number
): void {
  context.fillStyle = '#20232a';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#262a32';
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if (((x / size) | 0) % 2 === ((y / size) | 0) % 2) continue;
      context.fillRect(x, y, size, size);
    }
  }
}
