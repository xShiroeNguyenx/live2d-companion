import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ModelExplorer } from '../features/explorer/ModelExplorer';
import { ParameterPanel } from '../features/parameters/ParameterPanel';
import { ExpressionPanel } from '../features/expressions/ExpressionPanel';
import { MotionPanel } from '../features/motion/MotionPanel';
import { PosePanel } from '../features/pose/PosePanel';
import { PhysicsPanel } from '../features/physics/PhysicsPanel';
import { TexturePanel } from '../features/texture/TexturePanel';
import { ConfigPanel } from '../features/config/ConfigPanel';
import { ExportPanel } from '../features/export/ExportPanel';
import { PreviewCanvas } from '../features/preview/PreviewCanvas';
import { PreviewToolbar } from '../features/preview/PreviewToolbar';
import { useSessionStore } from '../document/stores/sessionStore';
import { useEditorUiStore, type PanelId } from '../document/stores/editorUiStore';
import { commandStack } from '../document/commands/CommandStack';
import { useCommandStack, useSaveStatus, useUndoRedoShortcuts } from './useCommandStack';

const PANELS: Array<{ id: PanelId; label: string }> = [
  { id: 'parameters', label: 'Tham số' },
  { id: 'motion', label: 'Cử động' },
  { id: 'expressions', label: 'Biểu cảm' },
  { id: 'pose', label: 'Trang phục' },
  { id: 'physics', label: 'Rung lắc' },
  { id: 'texture', label: 'Màu sắc' },
  { id: 'config', label: 'Cấu hình' },
  { id: 'export', label: 'Xuất' }
];

export function App() {
  const status = useSessionStore((state) => state.status);
  const error = useSessionStore((state) => state.error);
  const workspace = useSessionStore((state) => state.workspace);
  const activePanel = useEditorUiStore((state) => state.activePanel);
  const setActivePanel = useEditorUiStore((state) => state.setActivePanel);
  const undoState = useCommandStack();
  const save = useSaveStatus();

  useUndoRedoShortcuts();

  return (
    <div className="app">
      <header className="app__titlebar">
        <span className="app__brand">Live2D Companion Studio</span>
        {workspace && <span className="app__subject">{workspace.displayName}</span>}

        <div className="app__history">
          <button
            type="button"
            className="button button--ghost"
            disabled={!undoState.canUndo}
            title={undoState.undoLabel ? `Hoàn tác: ${undoState.undoLabel}` : 'Hoàn tác'}
            onClick={() => commandStack.undo()}
          >
            ↶
          </button>
          <button
            type="button"
            className="button button--ghost"
            disabled={!undoState.canRedo}
            title={undoState.redoLabel ? `Làm lại: ${undoState.redoLabel}` : 'Làm lại'}
            onClick={() => commandStack.redo()}
          >
            ↷
          </button>
        </div>

        <SaveIndicator status={save.status} error={save.error} />
        <span className="app__phase">Phase 1</span>
      </header>

      <PanelGroup direction="horizontal" className="app__body">
        <Panel defaultSize={20} minSize={14}>
          <ModelExplorer />
        </Panel>
        <PanelResizeHandle className="resize-handle" />

        <Panel defaultSize={54} minSize={30}>
          <div className="stage">
            <PreviewToolbar />
            {status === 'idle' ? (
              <div className="stage__empty">
                <p>Chưa có model nào được mở.</p>
                <p className="stage__empty-hint">
                  Chọn “Dùng model mẫu (Hiyori)” ở cột bên trái, hoặc mở thư mục model của bạn.
                </p>
              </div>
            ) : null}
            {status !== 'idle' && (
              <div className="stage__fill">
                <PreviewCanvas key={workspace?.id} />
              </div>
            )}
            {error && <div className="stage__error">{error}</div>}
          </div>
        </Panel>
        <PanelResizeHandle className="resize-handle" />

        <Panel defaultSize={26} minSize={18}>
          <div className="editor-column">
            <nav className="tabs">
              {PANELS.map((panel) => (
                <button
                  key={panel.id}
                  type="button"
                  className={`tab${activePanel === panel.id ? ' tab--active' : ''}`}
                  onClick={() => setActivePanel(panel.id)}
                >
                  {panel.label}
                </button>
              ))}
            </nav>
            <div className="editor-column__body">
              {activePanel === 'parameters' && <ParameterPanel />}
              {activePanel === 'motion' && <MotionPanel />}
              {activePanel === 'expressions' && <ExpressionPanel />}
              {activePanel === 'pose' && <PosePanel />}
              {activePanel === 'physics' && <PhysicsPanel />}
              {activePanel === 'texture' && <TexturePanel />}
              {activePanel === 'config' && <ConfigPanel />}
              {activePanel === 'export' && <ExportPanel />}
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

function SaveIndicator({ status, error }: { status: string; error?: string }) {
  const labels: Record<string, string> = {
    idle: '',
    pending: 'Sắp lưu…',
    saving: 'Đang lưu…',
    saved: 'Đã lưu',
    error: 'Lỗi lưu'
  };
  const label = labels[status] ?? '';
  if (!label) return null;

  return (
    <span
      className={`app__save app__save--${status}`}
      title={error ?? 'Thay đổi được lưu tự động vào workspace (bản gốc không bị sửa)'}
    >
      {label}
    </span>
  );
}
