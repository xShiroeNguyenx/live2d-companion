import { useEffect, useMemo, useRef } from 'react';
import { MotionSegmentType } from '@shared/types/live2d-files';
import type { MotionDocument, MotionTrack } from '../../core/motion/MotionDocument';
import { evaluateTrack } from '../../core/motion/MotionEvaluator';
import { snapTime, useMotionUiStore } from '../../document/stores/motionUiStore';

const PADDING = { top: 14, right: 12, bottom: 20, left: 40 };
const HANDLE_RADIUS = 4;
const KEYFRAME_RADIUS = 5;

export interface CurveEditorProps {
  document: MotionDocument;
  trackIndex: number;
  label: string;
  onEditKeyframe(
    keyframeIndex: number,
    change: { time?: number; value?: number },
    coalesceKey: string
  ): void;
  onEditHandle(
    keyframeIndex: number,
    which: 'control1' | 'control2',
    point: { time: number; value: number },
    coalesceKey: string
  ): void;
}

type DragTarget =
  | { kind: 'keyframe'; index: number }
  | { kind: 'handle'; index: number; which: 'control1' | 'control2' };

/**
 * The graph view of one curve: value against time, with draggable keyframes and
 * bezier handles.
 *
 * The dope sheet answers "when does something happen"; this answers "how". They
 * are separate views because the dope sheet has to stay readable across a
 * hundred tracks, while a graph is only legible for one curve at a time.
 *
 * Handles are clamped inside their segment as they are dragged. That is what
 * Cubism Editor does, and it keeps time monotonic across the segment so the
 * fast parametric evaluation stays valid — a handle dragged past its neighbour
 * would make the curve fold back and play differently in other runtimes.
 */
export function CurveEditor({
  document: motion,
  trackIndex,
  label,
  onEditKeyframe,
  onEditHandle
}: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const time = useMotionUiStore((state) => state.time);
  const snapEnabled = useMotionUiStore((state) => state.snapToFrames);
  const setTime = useMotionUiStore((state) => state.setTime);

  const track = motion.tracks[trackIndex] as MotionTrack | undefined;

  /** Value range with a margin, so keyframes never sit on the frame edge. */
  const range = useMemo(() => {
    if (!track || track.keyframes.length === 0) return { min: -1, max: 1 };

    let min = Infinity;
    let max = -Infinity;
    for (const keyframe of track.keyframes) {
      min = Math.min(min, keyframe.value);
      max = Math.max(max, keyframe.value);
      // Handles can overshoot the keyframes they connect, and the graph has to
      // show that rather than clipping it.
      for (const control of [keyframe.out?.control1, keyframe.out?.control2]) {
        if (!control) continue;
        min = Math.min(min, control.value);
        max = Math.max(max, control.value);
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: -1, max: 1 };
    if (max - min < 1e-6) return { min: min - 1, max: max + 1 };

    const margin = (max - min) * 0.12;
    return { min: min - margin, max: max + margin };
  }, [track]);

  const duration = Math.max(motion.duration, 0.1);

  // Read by the pointer handlers, which are installed once.
  const stateRef = useRef({ track, range, duration, snapEnabled, fps: motion.fps });
  stateRef.current = { track, range, duration, snapEnabled, fps: motion.fps };

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !track) return;

    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const plot = {
      x: PADDING.left,
      y: PADDING.top,
      width: width - PADDING.left - PADDING.right,
      height: height - PADDING.top - PADDING.bottom
    };
    const toX = (value: number): number => plot.x + (value / duration) * plot.width;
    const toY = (value: number): number =>
      plot.y + plot.height - ((value - range.min) / (range.max - range.min)) * plot.height;

    drawGrid(context, plot, range, duration);

    // The curve itself, sampled densely enough that beziers read as smooth.
    context.strokeStyle = '#6ea8fe';
    context.lineWidth = 1.5;
    context.beginPath();
    const samples = Math.max(64, Math.floor(plot.width));
    for (let step = 0; step <= samples; step += 1) {
      const at = (duration * step) / samples;
      const value = evaluateTrack(track, at, motion.areBeziersRestricted);
      const x = toX(at);
      const y = toY(value);
      if (step === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();

    // Handles under the keyframes, so a keyframe is always clickable on top.
    for (const [index, keyframe] of track.keyframes.entries()) {
      if (keyframe.out?.type !== MotionSegmentType.Bezier) continue;
      const next = track.keyframes[index + 1];
      if (!next || !keyframe.out.control1 || !keyframe.out.control2) continue;

      drawHandle(context, toX(keyframe.time), toY(keyframe.value),
        toX(keyframe.out.control1.time), toY(keyframe.out.control1.value));
      drawHandle(context, toX(next.time), toY(next.value),
        toX(keyframe.out.control2.time), toY(keyframe.out.control2.value));
    }

    for (const keyframe of track.keyframes) {
      const x = toX(keyframe.time);
      const y = toY(keyframe.value);
      context.fillStyle = '#6ea8fe';
      context.strokeStyle = '#10131a';
      context.lineWidth = 1;
      context.beginPath();
      context.arc(x, y, KEYFRAME_RADIUS, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    }

    // Playhead on top of everything.
    const playheadX = toX(Math.min(time, duration));
    context.strokeStyle = '#ff8785';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(playheadX, plot.y);
    context.lineTo(playheadX, plot.y + plot.height);
    context.stroke();

    // Current value readout, which is what makes the graph usable while
    // scrubbing: the number under the playhead.
    const current = evaluateTrack(track, time, motion.areBeziersRestricted);
    context.fillStyle = '#ff8785';
    context.font = '10px "Segoe UI", system-ui, sans-serif';
    context.fillText(current.toFixed(3), playheadX + 4, plot.y + 10);
  }, [track, range, duration, time, motion.areBeziersRestricted, label]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const geometry = () => {
      const rect = canvas.getBoundingClientRect();
      return {
        rect,
        x: PADDING.left,
        y: PADDING.top,
        width: rect.width - PADDING.left - PADDING.right,
        height: rect.height - PADDING.top - PADDING.bottom
      };
    };

    /** Screen point to curve space. */
    const toCurve = (event: PointerEvent): { time: number; value: number } => {
      const plot = geometry();
      const { range: currentRange, duration: currentDuration } = stateRef.current;
      const px = event.clientX - plot.rect.left - plot.x;
      const py = event.clientY - plot.rect.top - plot.y;
      return {
        time: Math.max(0, Math.min(currentDuration, (px / plot.width) * currentDuration)),
        value:
          currentRange.max - (py / plot.height) * (currentRange.max - currentRange.min)
      };
    };

    /** What the pointer is over: a handle takes priority over its keyframe. */
    const hitTest = (event: PointerEvent): DragTarget | null => {
      const current = stateRef.current.track;
      if (!current) return null;

      const plot = geometry();
      const { range: currentRange, duration: currentDuration } = stateRef.current;
      const toX = (value: number): number =>
        plot.rect.left + plot.x + (value / currentDuration) * plot.width;
      const toY = (value: number): number =>
        plot.rect.top +
        plot.y +
        plot.height -
        ((value - currentRange.min) / (currentRange.max - currentRange.min)) * plot.height;

      const near = (x: number, y: number, radius: number): boolean =>
        Math.hypot(event.clientX - x, event.clientY - y) <= radius + 3;

      for (const [index, keyframe] of current.keyframes.entries()) {
        if (keyframe.out?.type !== MotionSegmentType.Bezier) continue;
        const control1 = keyframe.out.control1;
        const control2 = keyframe.out.control2;
        if (control1 && near(toX(control1.time), toY(control1.value), HANDLE_RADIUS)) {
          return { kind: 'handle', index, which: 'control1' };
        }
        if (control2 && near(toX(control2.time), toY(control2.value), HANDLE_RADIUS)) {
          return { kind: 'handle', index, which: 'control2' };
        }
      }

      for (const [index, keyframe] of current.keyframes.entries()) {
        if (near(toX(keyframe.time), toY(keyframe.value), KEYFRAME_RADIUS)) {
          return { kind: 'keyframe', index };
        }
      }
      return null;
    };

    let dragging: DragTarget | null = null;

    const onPointerDown = (event: PointerEvent): void => {
      dragging = hitTest(event);
      if (dragging) {
        canvas.setPointerCapture(event.pointerId);
        return;
      }
      // Clicking empty graph space scrubs, matching the dope sheet.
      setTime(
        snapTime(toCurve(event).time, stateRef.current.fps, stateRef.current.snapEnabled)
      );
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const current = stateRef.current.track;
      if (!current) return;

      const point = toCurve(event);

      if (dragging.kind === 'keyframe') {
        onEditKeyframe(
          dragging.index,
          {
            time: snapTime(point.time, stateRef.current.fps, stateRef.current.snapEnabled),
            value: point.value
          },
          `curve:${trackIndex}:kf:${dragging.index}`
        );
        return;
      }

      // Handle times are clamped into their segment as they move: this is what
      // keeps the curve evaluable by the fast path in every runtime.
      const keyframe = current.keyframes[dragging.index];
      const next = current.keyframes[dragging.index + 1];
      if (!keyframe || !next) return;

      const clampedTime = Math.min(Math.max(point.time, keyframe.time), next.time);
      onEditHandle(
        dragging.index,
        dragging.which,
        { time: clampedTime, value: point.value },
        `curve:${trackIndex}:handle:${dragging.index}:${dragging.which}`
      );
    };

    const onPointerUp = (event: PointerEvent): void => {
      dragging = null;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
    };
  }, [trackIndex, onEditKeyframe, onEditHandle, setTime]);

  if (!track) return null;

  return (
    <div className="curve-editor">
      <div className="curve-editor__label">{label}</div>
      <canvas ref={canvasRef} className="curve-editor__canvas" />
    </div>
  );
}

function drawGrid(
  context: CanvasRenderingContext2D,
  plot: { x: number; y: number; width: number; height: number },
  range: { min: number; max: number },
  duration: number
): void {
  context.fillStyle = '#1b1d23';
  context.fillRect(plot.x, plot.y, plot.width, plot.height);

  context.font = '9px "Segoe UI", system-ui, sans-serif';
  context.textBaseline = 'middle';

  // Value gridlines, including zero picked out so the neutral pose is obvious.
  const lines = 4;
  for (let index = 0; index <= lines; index += 1) {
    const value = range.min + ((range.max - range.min) * index) / lines;
    const y = plot.y + plot.height - (index / lines) * plot.height;
    context.strokeStyle = Math.abs(value) < 1e-6 ? '#4a5160' : '#2b2f39';
    context.beginPath();
    context.moveTo(plot.x, y);
    context.lineTo(plot.x + plot.width, y);
    context.stroke();

    context.fillStyle = '#9aa1ad';
    context.textAlign = 'right';
    context.fillText(value.toFixed(1), plot.x - 4, y);
  }

  context.textAlign = 'left';
  const steps = 4;
  for (let index = 0; index <= steps; index += 1) {
    const at = (duration * index) / steps;
    const x = plot.x + (index / steps) * plot.width;
    context.strokeStyle = '#2b2f39';
    context.beginPath();
    context.moveTo(x, plot.y);
    context.lineTo(x, plot.y + plot.height);
    context.stroke();

    context.fillStyle = '#9aa1ad';
    context.fillText(`${at.toFixed(1)}s`, x + 2, plot.y + plot.height + 8);
  }
}

/** A bezier handle: a line from its keyframe to a draggable dot. */
function drawHandle(
  context: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
  handleX: number,
  handleY: number
): void {
  context.strokeStyle = '#5a6478';
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(anchorX, anchorY);
  context.lineTo(handleX, handleY);
  context.stroke();

  context.fillStyle = '#f0b849';
  context.beginPath();
  context.arc(handleX, handleY, HANDLE_RADIUS, 0, Math.PI * 2);
  context.fill();
}
