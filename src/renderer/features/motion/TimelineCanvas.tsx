import { useEffect, useRef } from 'react';
import { MotionSegmentType } from '@shared/types/live2d-files';
import type { MotionDocument } from '../../core/motion/MotionDocument';
import { snapTime, useMotionUiStore, type SelectedKeyframe } from '../../document/stores/motionUiStore';

/** Row height in CSS pixels; keyframe diamonds are sized from it. */
const ROW_HEIGHT = 18;
const RULER_HEIGHT = 22;
const KEYFRAME_RADIUS = 4;

export interface TimelineCanvasProps {
  document: MotionDocument;
  /** Track names as the panel shows them, aligned with `document.tracks`. */
  trackLabels: string[];
  /** Vertical scroll offset shared with the track-name column. */
  scrollTop: number;
  onScroll(scrollTop: number): void;
  onMoveKeyframe(trackIndex: number, keyframeIndex: number, time: number): void;
  onAddKeyframe(trackIndex: number, time: number): void;
}

/**
 * The dope sheet: one row per curve, a diamond per keyframe.
 *
 * Drawn on a canvas rather than as DOM elements because a real motion has 30–100
 * curves with dozens of keyframes each, and that many absolutely-positioned
 * divs makes dragging visibly stutter. A canvas redraws the whole sheet in well
 * under a frame.
 */
export function TimelineCanvas({
  document: motion,
  trackLabels,
  scrollTop,
  onScroll,
  onMoveKeyframe,
  onAddKeyframe
}: TimelineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const time = useMotionUiStore((state) => state.time);
  const selection = useMotionUiStore((state) => state.selection);
  const snapEnabled = useMotionUiStore((state) => state.snapToFrames);
  const setTime = useMotionUiStore((state) => state.setTime);
  const toggleSelected = useMotionUiStore((state) => state.toggleSelected);

  // Kept in a ref so the pointer handlers, which are installed once, always see
  // the current values without re-installing on every render.
  const stateRef = useRef({ motion, selection, snapEnabled, scrollTop });
  stateRef.current = { motion, selection, snapEnabled, scrollTop };

  const duration = Math.max(motion.duration, 0.1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }

    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const timeToX = (value: number): number => (value / duration) * width;

    drawRuler(context, width, duration, motion.fps);

    // Only the visible rows are drawn; a long track list would otherwise cost
    // work proportional to its length on every frame of a drag.
    const firstRow = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT));
    const lastRow = Math.min(
      motion.tracks.length - 1,
      Math.ceil((scrollTop + height - RULER_HEIGHT) / ROW_HEIGHT)
    );

    for (let index = firstRow; index <= lastRow; index += 1) {
      const track = motion.tracks[index];
      if (!track) continue;
      const y = RULER_HEIGHT + index * ROW_HEIGHT - scrollTop + ROW_HEIGHT / 2;
      if (y < RULER_HEIGHT - ROW_HEIGHT || y > height + ROW_HEIGHT) continue;

      // Row banding, so the eye can follow a row across a wide sheet.
      context.fillStyle = index % 2 === 0 ? '#23262e' : '#262a33';
      context.fillRect(0, y - ROW_HEIGHT / 2, width, ROW_HEIGHT);

      // The span the curve actually covers, so gaps are visible.
      const first = track.keyframes[0];
      const last = track.keyframes[track.keyframes.length - 1];
      if (first && last && last.time > first.time) {
        context.strokeStyle = '#3d6cb0';
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(timeToX(first.time), y);
        context.lineTo(timeToX(last.time), y);
        context.stroke();
      }

      for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
        const x = timeToX(keyframe.time);
        const isSelected = selection.some(
          (entry) => entry.trackIndex === index && entry.keyframeIndex === keyframeIndex
        );
        drawKeyframe(context, x, y, keyframe.out?.type, isSelected);
      }
    }

    // Playhead last, so it sits above the rows.
    const playheadX = timeToX(time);
    context.strokeStyle = '#ff8785';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(playheadX, 0);
    context.lineTo(playheadX, height);
    context.stroke();

    void trackLabels;
  }, [motion, trackLabels, selection, time, duration, scrollTop]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const toTime = (event: PointerEvent): number => {
      const rect = canvas.getBoundingClientRect();
      const raw = ((event.clientX - rect.left) / rect.width) * duration;
      return snapTime(raw, stateRef.current.motion.fps, stateRef.current.snapEnabled);
    };

    const toRow = (event: PointerEvent): number => {
      const rect = canvas.getBoundingClientRect();
      const y = event.clientY - rect.top - RULER_HEIGHT + stateRef.current.scrollTop;
      return Math.floor(y / ROW_HEIGHT);
    };

    /** The keyframe under the cursor, within a few pixels. */
    const hitKeyframe = (event: PointerEvent): SelectedKeyframe | null => {
      const trackIndex = toRow(event);
      const track = stateRef.current.motion.tracks[trackIndex];
      if (!track) return null;

      const rect = canvas.getBoundingClientRect();
      const pointerTime = ((event.clientX - rect.left) / rect.width) * duration;
      // Convert the pixel tolerance into a time tolerance so the hit area is
      // the same size on screen regardless of zoom.
      const tolerance = (KEYFRAME_RADIUS * 2 * duration) / rect.width;

      let best: SelectedKeyframe | null = null;
      let bestDistance = tolerance;
      for (const [keyframeIndex, keyframe] of track.keyframes.entries()) {
        const distance = Math.abs(keyframe.time - pointerTime);
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { trackIndex, keyframeIndex };
        }
      }
      return best;
    };

    let dragging: SelectedKeyframe | null = null;
    let scrubbing = false;

    const onPointerDown = (event: PointerEvent): void => {
      const rect = canvas.getBoundingClientRect();
      const inRuler = event.clientY - rect.top < RULER_HEIGHT;

      if (inRuler) {
        scrubbing = true;
        setTime(toTime(event));
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      const hit = hitKeyframe(event);
      if (hit) {
        dragging = hit;
        toggleSelected(hit, event.ctrlKey || event.shiftKey);
        canvas.setPointerCapture(event.pointerId);
        return;
      }

      // Double-click on empty row space adds a keyframe there; a single click
      // just moves the playhead, which is the more common intent.
      if (event.detail >= 2) {
        const trackIndex = toRow(event);
        if (stateRef.current.motion.tracks[trackIndex]) {
          onAddKeyframe(trackIndex, toTime(event));
        }
        return;
      }
      setTime(toTime(event));
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (scrubbing) {
        setTime(toTime(event));
        return;
      }
      if (dragging) {
        onMoveKeyframe(dragging.trackIndex, dragging.keyframeIndex, toTime(event));
      }
    };

    const onPointerUp = (event: PointerEvent): void => {
      dragging = null;
      scrubbing = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      onScroll(stateRef.current.scrollTop + event.deltaY);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [duration, setTime, toggleSelected, onMoveKeyframe, onAddKeyframe, onScroll]);

  return <canvas ref={canvasRef} className="timeline__canvas" />;
}

function drawRuler(
  context: CanvasRenderingContext2D,
  width: number,
  duration: number,
  fps: number
): void {
  context.fillStyle = '#1b1d23';
  context.fillRect(0, 0, width, RULER_HEIGHT);

  // Choose a tick spacing that keeps labels readable at any duration.
  const targetPixels = 60;
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30];
  const step =
    candidates.find((value) => (value / duration) * width >= targetPixels) ??
    candidates[candidates.length - 1];

  context.font = '10px "Segoe UI", system-ui, sans-serif';
  context.textBaseline = 'middle';

  for (let value = 0; value <= duration + 1e-6; value += step) {
    const x = (value / duration) * width;
    context.strokeStyle = '#363b46';
    context.beginPath();
    context.moveTo(x, RULER_HEIGHT - 6);
    context.lineTo(x, RULER_HEIGHT);
    context.stroke();

    context.fillStyle = '#9aa1ad';
    context.fillText(`${value.toFixed(step < 1 ? 1 : 0)}s`, x + 3, RULER_HEIGHT / 2);
  }

  void fps;
}

/**
 * Draws one keyframe, shaped by the segment leaving it.
 *
 * The shape carries the interpolation type so a user can read a curve's timing
 * from the sheet without opening the graph: a square holds its value, a diamond
 * moves smoothly.
 */
function drawKeyframe(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  type: MotionSegmentType | undefined,
  selected: boolean
): void {
  context.fillStyle = selected ? '#ff8785' : '#6ea8fe';
  context.strokeStyle = '#10131a';
  context.lineWidth = 1;

  if (type === MotionSegmentType.Stepped || type === MotionSegmentType.InverseStepped) {
    context.beginPath();
    context.rect(x - KEYFRAME_RADIUS, y - KEYFRAME_RADIUS, KEYFRAME_RADIUS * 2, KEYFRAME_RADIUS * 2);
    context.fill();
    context.stroke();
    return;
  }

  context.beginPath();
  context.moveTo(x, y - KEYFRAME_RADIUS);
  context.lineTo(x + KEYFRAME_RADIUS, y);
  context.lineTo(x, y + KEYFRAME_RADIUS);
  context.lineTo(x - KEYFRAME_RADIUS, y);
  context.closePath();
  context.fill();
  context.stroke();
}

export const TIMELINE_ROW_HEIGHT = ROW_HEIGHT;
export const TIMELINE_RULER_HEIGHT = RULER_HEIGHT;
