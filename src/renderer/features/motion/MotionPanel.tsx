import { useCallback, useMemo, useState } from 'react';
import { MotionSegmentType } from '@shared/types/live2d-files';
import { useSessionStore } from '../../document/stores/sessionStore';
import { motionsStore } from '../../document/stores/documentStores';
import { useMotionUiStore } from '../../document/stores/motionUiStore';
import { moveKeyframe, removeKeyframe, setKeyframe } from '../../core/motion/MotionPlayback';
import { recordFrameNow } from '../../document/motionRecorder';
import { defaultBezierHandles } from '../../core/motion/MotionDocument';
import { CurveEditor } from './CurveEditor';
import { TimelineCanvas, TIMELINE_ROW_HEIGHT } from './TimelineCanvas';

/**
 * Edits motion3.json files: which motions the model has, and what each animates.
 *
 * The panel is built around one idea for non-technical users — you do not author
 * curves, you perform. Arm record, drag the parameter sliders while the playhead
 * runs, and the panel writes keyframes where you were. The dope sheet is then
 * there to clean up what you recorded, rather than being the way in.
 */
export function MotionPanel() {
  const info = useSessionStore((state) => state.info);
  const motions = motionsStore((state) => state.data);
  const editMotions = motionsStore((state) => state.edit);

  const activePath = useMotionUiStore((state) => state.activePath);
  const openMotion = useMotionUiStore((state) => state.openMotion);
  const time = useMotionUiStore((state) => state.time);
  const playing = useMotionUiStore((state) => state.playing);
  const loop = useMotionUiStore((state) => state.loop);
  const speed = useMotionUiStore((state) => state.speed);
  const recording = useMotionUiStore((state) => state.recording);
  const snapToFrames = useMotionUiStore((state) => state.snapToFrames);
  const selection = useMotionUiStore((state) => state.selection);
  const setTime = useMotionUiStore((state) => state.setTime);
  const setPlaying = useMotionUiStore((state) => state.setPlaying);
  const setLoop = useMotionUiStore((state) => state.setLoop);
  const setSpeed = useMotionUiStore((state) => state.setSpeed);
  const setRecording = useMotionUiStore((state) => state.setRecording);
  const setSnapToFrames = useMotionUiStore((state) => state.setSnapToFrames);
  const clearSelection = useMotionUiStore((state) => state.clearSelection);
  const expandedTrack = useMotionUiStore((state) => state.expandedTrack);
  const expandTrack = useMotionUiStore((state) => state.expandTrack);

  const [scrollTop, setScrollTop] = useState(0);

  const motion = activePath ? motions.byPath[activePath] : null;

  /** Track names, using cdi3 display names where the model has them. */
  const trackLabels = useMemo(() => {
    if (!motion || !info) return [];
    return motion.tracks.map((track) => {
      if (track.target === 'Parameter') {
        return info.parameters.find((entry) => entry.id === track.id)?.name ?? track.id;
      }
      if (track.target === 'PartOpacity') {
        return info.parts.find((entry) => entry.id === track.id)?.name ?? track.id;
      }
      return track.id;
    });
  }, [motion, info]);

  const handleMoveKeyframe = useCallback(
    (trackIndex: number, keyframeIndex: number, nextTime: number) => {
      if (!activePath) return;
      editMotions(
        'Di chuyển keyframe',
        (draft) => {
          const track = draft.byPath[activePath]?.tracks[trackIndex];
          const keyframe = track?.keyframes[keyframeIndex];
          if (!track || !keyframe) return;
          moveKeyframe(track, keyframeIndex, nextTime, keyframe.value);
        },
        // One drag is one undo step.
        `motion:${activePath}:${trackIndex}:${keyframeIndex}`
      );
    },
    [activePath, editMotions]
  );

  const handleAddKeyframe = useCallback(
    (trackIndex: number, atTime: number) => {
      if (!activePath) return;
      editMotions('Thêm keyframe', (draft) => {
        const document = draft.byPath[activePath];
        const track = document?.tracks[trackIndex];
        if (!document || !track) return;
        // The new keyframe takes the curve's current value there, so adding one
        // does not change how the motion looks — only what can be edited.
        const value = valueAt(track.keyframes, atTime);
        setKeyframe(track, atTime, value);
      });
    },
    [activePath, editMotions]
  );

  const handleDeleteSelection = (): void => {
    if (!activePath || selection.length === 0) return;
    editMotions(`Xoá ${selection.length} keyframe`, (draft) => {
      const document = draft.byPath[activePath];
      if (!document) return;
      // Descending order, so removing one does not shift the indices of the
      // ones still to be removed.
      const ordered = [...selection].sort(
        (a, b) => b.trackIndex - a.trackIndex || b.keyframeIndex - a.keyframeIndex
      );
      for (const entry of ordered) {
        const track = document.tracks[entry.trackIndex];
        // A curve needs two keyframes to be a curve; below that, drop it.
        if (track && track.keyframes.length > 2) removeKeyframe(track, entry.keyframeIndex);
      }
    });
    clearSelection();
  };

  const handleSegmentType = (type: MotionSegmentType): void => {
    if (!activePath || selection.length === 0) return;
    editMotions('Đổi kiểu nội suy', (draft) => {
      const document = draft.byPath[activePath];
      if (!document) return;
      for (const entry of selection) {
        const keyframe = document.tracks[entry.trackIndex]?.keyframes[entry.keyframeIndex];
        // The last keyframe of a track has no outgoing segment to change.
        if (keyframe?.out) keyframe.out.type = type;
      }
    });
  };

  const handleCurveKeyframe = useCallback(
    (
      keyframeIndex: number,
      change: { time?: number; value?: number },
      coalesceKey: string
    ) => {
      if (!activePath || expandedTrack === null) return;
      editMotions(
        'Sửa keyframe',
        (draft) => {
          const track = draft.byPath[activePath]?.tracks[expandedTrack];
          const keyframe = track?.keyframes[keyframeIndex];
          if (!track || !keyframe) return;
          moveKeyframe(
            track,
            keyframeIndex,
            change.time ?? keyframe.time,
            change.value ?? keyframe.value
          );
        },
        coalesceKey
      );
    },
    [activePath, editMotions, expandedTrack]
  );

  const handleCurveHandle = useCallback(
    (
      keyframeIndex: number,
      which: 'control1' | 'control2',
      point: { time: number; value: number },
      coalesceKey: string
    ) => {
      if (!activePath || expandedTrack === null) return;
      editMotions(
        'Sửa độ cong',
        (draft) => {
          const track = draft.byPath[activePath]?.tracks[expandedTrack];
          const keyframe = track?.keyframes[keyframeIndex];
          if (!keyframe?.out) return;
          const control = keyframe.out[which];
          if (!control) return;
          control.time = point.time;
          control.value = point.value;
        },
        coalesceKey
      );
    },
    [activePath, editMotions, expandedTrack]
  );

  /**
   * Turns a segment into a bezier so it has handles to drag.
   *
   * A linear segment has no control points, so the graph would have nothing to
   * grab. Converting seeds handles at the thirds, which is the shape Cubism
   * Editor starts from and leaves the curve looking unchanged.
   */
  const handleMakeSmooth = (): void => {
    if (!activePath || expandedTrack === null) return;
    editMotions('Chuyển sang đường cong', (draft) => {
      const track = draft.byPath[activePath]?.tracks[expandedTrack];
      if (!track) return;
      for (let index = 0; index < track.keyframes.length - 1; index += 1) {
        const from = track.keyframes[index];
        const to = track.keyframes[index + 1];
        if (from.out?.type === MotionSegmentType.Bezier) continue;
        const handles = defaultBezierHandles(from, to);
        from.out = { type: MotionSegmentType.Bezier, ...handles };
      }
    });
  };

  const handleNewMotion = (): void => {
    window.alert(
      'Tạo motion mới sẽ có ở bản sau. Hiện tại hãy chọn một motion có sẵn để sửa.'
    );
  };

  if (!info) return <aside className="panel" />;

  const groupNames = motions.groupOrder;
  const hasMotions = groupNames.length > 0;

  return (
    <aside className="panel panel--motion">
      <header className="panel__header">
        <h2>Cử động</h2>
        <button type="button" className="button button--ghost" onClick={handleNewMotion}>
          + Motion
        </button>
      </header>

      {!hasMotions ? (
        <p className="panel__empty">Model chưa có motion nào.</p>
      ) : (
        <div className="motion-list">
          {groupNames.map((group) => (
            <section key={group} className="motion-group">
              <h3 className="motion-group__title">
                {group}
                {group === 'Idle' && <span className="motion-group__badge">tự phát</span>}
              </h3>
              {(motions.groups[group] ?? []).map((path) => (
                <button
                  key={path}
                  type="button"
                  className={`motion-item${activePath === path ? ' motion-item--active' : ''}`}
                  onClick={() => openMotion(activePath === path ? null : path)}
                >
                  <span className="motion-item__name">{fileLabel(path)}</span>
                  <span className="motion-item__meta">
                    {motions.byPath[path]?.duration.toFixed(1)}s ·{' '}
                    {motions.byPath[path]?.tracks.length} track
                  </span>
                </button>
              ))}
            </section>
          ))}
        </div>
      )}

      {motion && activePath && (
        <>
          <div className="transport">
            <button
              type="button"
              className="transport__button"
              title={playing ? 'Tạm dừng' : 'Phát'}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? '❚❚' : '▶'}
            </button>
            <button
              type="button"
              className="transport__button"
              title="Về đầu"
              onClick={() => {
                setPlaying(false);
                setTime(0);
              }}
            >
              ⏮
            </button>
            <span className="transport__time">
              {time.toFixed(2)} / {motion.duration.toFixed(2)}s
            </span>
            <label className="transport__toggle" title="Lặp lại">
              <input
                type="checkbox"
                checked={loop}
                onChange={(event) => setLoop(event.target.checked)}
              />
              Lặp
            </label>
            <select
              className="transport__speed"
              value={speed}
              title="Tốc độ phát"
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              <option value={0.25}>0.25×</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
            </select>
          </div>

          <div className="motion-record">
            <button
              type="button"
              className={`button${recording ? ' button--recording' : ''}`}
              onClick={() => setRecording(!recording)}
            >
              {recording ? '● Đang ghi' : '● Ghi từ slider'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              title="Ghi dáng hiện tại thành keyframe tại vị trí playhead"
              onClick={recordFrameNow}
            >
              Ghi 1 frame
            </button>
          </div>

          <p className="panel__hint">
            Ghim tham số ở tab “Tham số” rồi bấm Ghi — kéo slider trong lúc phát, app tự
            tạo keyframe. Chỉ tham số đang ghim được ghi lại.
          </p>

          <div className="timeline">
            <div
              className="timeline__names"
              style={{ transform: `translateY(${-scrollTop}px)` }}
            >
              {motion.tracks.map((track, index) => (
                <button
                  key={`${track.target}:${track.id}`}
                  type="button"
                  className={`timeline__name${
                    expandedTrack === index ? ' timeline__name--open' : ''
                  }`}
                  style={{ height: TIMELINE_ROW_HEIGHT }}
                  title={`${track.id} (${track.target}) — bấm để xem đồ thị`}
                  onClick={() => expandTrack(expandedTrack === index ? null : index)}
                >
                  {trackLabels[index]}
                </button>
              ))}
            </div>
            <div className="timeline__sheet">
              <TimelineCanvas
                document={motion}
                trackLabels={trackLabels}
                scrollTop={scrollTop}
                onScroll={(next) =>
                  setScrollTop(
                    Math.max(
                      0,
                      Math.min(next, Math.max(0, motion.tracks.length * TIMELINE_ROW_HEIGHT - 100))
                    )
                  )
                }
                onMoveKeyframe={handleMoveKeyframe}
                onAddKeyframe={handleAddKeyframe}
              />
            </div>
          </div>

          {expandedTrack !== null && motion.tracks[expandedTrack] && (
            <div className="curve-panel">
              <div className="curve-panel__bar">
                <span className="curve-panel__title">
                  Đồ thị: {trackLabels[expandedTrack]}
                </span>
                <button
                  type="button"
                  className="button button--ghost"
                  title="Cho mọi đoạn thành đường cong để kéo được độ cong"
                  onClick={handleMakeSmooth}
                >
                  Làm mượt
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => expandTrack(null)}
                >
                  Đóng
                </button>
              </div>
              <CurveEditor
                document={motion}
                trackIndex={expandedTrack}
                label={trackLabels[expandedTrack]}
                onEditKeyframe={handleCurveKeyframe}
                onEditHandle={handleCurveHandle}
              />
            </div>
          )}

          <div className="motion-tools">
            <label className="transport__toggle" title="Bám vào lưới frame">
              <input
                type="checkbox"
                checked={snapToFrames}
                onChange={(event) => setSnapToFrames(event.target.checked)}
              />
              Bám frame ({motion.fps}fps)
            </label>
            {selection.length > 0 && (
              <>
                <span className="motion-tools__count">{selection.length} keyframe</span>
                <select
                  className="transport__speed"
                  defaultValue=""
                  title="Kiểu nội suy"
                  onChange={(event) => {
                    if (event.target.value !== '') {
                      handleSegmentType(Number(event.target.value) as MotionSegmentType);
                    }
                  }}
                >
                  <option value="">Kiểu…</option>
                  <option value={MotionSegmentType.Linear}>Thẳng</option>
                  <option value={MotionSegmentType.Bezier}>Mượt (bezier)</option>
                  <option value={MotionSegmentType.Stepped}>Giữ nguyên</option>
                  <option value={MotionSegmentType.InverseStepped}>Nhảy ngay</option>
                </select>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={handleDeleteSelection}
                >
                  Xoá
                </button>
              </>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/** Filename without the directory or the long extension. */
function fileLabel(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.replace(/\.motion3\.json$/i, '');
}

/** The curve's value at a time, for inserting a keyframe that changes nothing. */
function valueAt(
  keyframes: Array<{ time: number; value: number }>,
  time: number
): number {
  if (keyframes.length === 0) return 0;
  if (time <= keyframes[0].time) return keyframes[0].value;
  const last = keyframes[keyframes.length - 1];
  if (time >= last.time) return last.value;

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const from = keyframes[index];
    const to = keyframes[index + 1];
    if (time >= from.time && time <= to.time) {
      const span = to.time - from.time;
      if (span <= 0) return to.value;
      return from.value + ((to.value - from.value) * (time - from.time)) / span;
    }
  }
  return last.value;
}
