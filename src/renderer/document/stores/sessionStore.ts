import { create } from 'zustand';
import type { WorkspaceSummary } from '@shared/types/workspace';
import type { ModelInfo } from '../../core/cubism/ModelInfo';
import type { RuntimeToggles } from '../../core/cubism/EditorRuntime';
import { defaultToggles } from '../../core/cubism/EditorRuntime';

export type SessionStatus = 'idle' | 'loading' | 'ready' | 'error';

interface SessionState {
  status: SessionStatus;
  error: string | null;
  workspace: WorkspaceSummary | null;
  /** Directory of model3.json inside the workspace, with trailing slash. */
  baseDir: string;
  /** Texture pixel sizes, for the export check on power-of-two dimensions. */
  textureSizes: Array<{ width: number; height: number }>;
  /** Populated once the moc is loaded; the authority for every panel. */
  info: ModelInfo | null;
  /** Current parameter values, mirrored for the UI to render sliders from. */
  parameterValues: Float32Array | null;
  /** Parameter indices the user has pinned. */
  pinned: ReadonlySet<number>;
  toggles: RuntimeToggles;
  recentWorkspaces: WorkspaceSummary[];

  beginLoading(workspace: WorkspaceSummary): void;
  setReady(
    info: ModelInfo,
    values: Float32Array,
    baseDir: string,
    textureSizes: Array<{ width: number; height: number }>
  ): void;
  setError(message: string): void;
  setRecentWorkspaces(list: WorkspaceSummary[]): void;
  /** Mirrors the runtime's values into React without reallocating each frame. */
  syncParameterValues(values: Float32Array): void;
  togglePin(parameterIndex: number): void;
  clearPins(): void;
  setToggle(key: keyof RuntimeToggles, value: boolean): void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: 'idle',
  error: null,
  workspace: null,
  baseDir: '',
  textureSizes: [],
  info: null,
  parameterValues: null,
  pinned: new Set<number>(),
  toggles: { ...defaultToggles },
  recentWorkspaces: [],

  beginLoading: (workspace) =>
    set({
      status: 'loading',
      error: null,
      workspace,
      info: null,
      parameterValues: null,
      baseDir: '',
      textureSizes: []
    }),

  setReady: (info, values, baseDir, textureSizes) =>
    set({
      status: 'ready',
      error: null,
      info,
      parameterValues: values,
      baseDir,
      textureSizes
    }),

  setError: (message) => set({ status: 'error', error: message }),

  setRecentWorkspaces: (list) => set({ recentWorkspaces: list }),

  // A new array identity each sync is what tells React to re-render; the
  // underlying values are copied from the runtime's live buffer.
  syncParameterValues: (values) => set({ parameterValues: Float32Array.from(values) }),

  togglePin: (parameterIndex) =>
    set((state) => {
      const next = new Set(state.pinned);
      if (next.has(parameterIndex)) next.delete(parameterIndex);
      else next.add(parameterIndex);
      return { pinned: next };
    }),

  clearPins: () => set({ pinned: new Set<number>() }),

  setToggle: (key, value) =>
    set((state) => ({ toggles: { ...state.toggles, [key]: value } }))
}));

// Exposed so `scripts/smoke-test.js` can drive a real load and assert the model
// actually rendered. Harmless in production, but kept explicit rather than
// implicit so it is obvious why a global exists.
(window as unknown as { __sessionStore?: typeof useSessionStore }).__sessionStore =
  useSessionStore;
