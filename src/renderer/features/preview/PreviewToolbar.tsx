import { useSessionStore } from '../../document/stores/sessionStore';
import { runtimeRef } from '../../document/runtimeRef';

/**
 * Which animation sources run in the preview.
 *
 * These exist because an editor needs to isolate what it is tuning: physics off
 * while posing, physics on while testing hair, mouse-follow on to check the
 * gaze range.
 */
export function PreviewToolbar() {
  const toggles = useSessionStore((state) => state.toggles);
  const setToggle = useSessionStore((state) => state.setToggle);
  const status = useSessionStore((state) => state.status);
  const pinnedCount = useSessionStore((state) => state.pinned.size);

  const disabled = status !== 'ready';

  return (
    <div className="toolbar">
      <label className="toolbar__toggle">
        <input
          type="checkbox"
          checked={toggles.motion}
          disabled={disabled}
          onChange={(event) => setToggle('motion', event.target.checked)}
        />
        Cử động
      </label>
      <label className="toolbar__toggle">
        <input
          type="checkbox"
          checked={toggles.expressions}
          disabled={disabled}
          onChange={(event) => setToggle('expressions', event.target.checked)}
        />
        Biểu cảm
      </label>
      <label className="toolbar__toggle">
        <input
          type="checkbox"
          checked={toggles.physics}
          disabled={disabled}
          onChange={(event) => setToggle('physics', event.target.checked)}
        />
        Physics
      </label>
      <label className="toolbar__toggle">
        <input
          type="checkbox"
          checked={toggles.pose}
          disabled={disabled}
          onChange={(event) => setToggle('pose', event.target.checked)}
        />
        Pose
      </label>
      <label className="toolbar__toggle">
        <input
          type="checkbox"
          checked={toggles.mouseFollow}
          disabled={disabled}
          onChange={(event) => setToggle('mouseFollow', event.target.checked)}
        />
        Nhìn theo chuột
      </label>

      <span className="toolbar__spacer" />

      {pinnedCount > 0 && (
        <span className="toolbar__badge">{pinnedCount} tham số đang ghim</span>
      )}
      <button
        type="button"
        className="button button--ghost"
        disabled={disabled}
        onClick={() => runtimeRef.current?.resetToDefaults()}
      >
        Về mặc định
      </button>
      <span className="toolbar__hint">Lăn chuột: zoom · Kéo: di chuyển · Nháy đúp: fit</span>
    </div>
  );
}
