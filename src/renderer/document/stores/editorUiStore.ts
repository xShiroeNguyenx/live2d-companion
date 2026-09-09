import { create } from 'zustand';

export type PanelId =
  | 'parameters'
  | 'motion'
  | 'expressions'
  | 'pose'
  | 'physics'
  | 'texture'
  | 'config'
  | 'export';

/**
 * What clicking the model canvas currently does.
 *
 * `none` is normal navigation. `pickDrawable` waits for the user to click a mesh
 * so it can be assigned as a hit area. `testHitAreas` reports which configured
 * hit area a tap would trigger, using the runtime's own bounding-box rule.
 */
export type CanvasMode = 'none' | 'pickDrawable' | 'testHitAreas';

interface EditorUiState {
  /** Which editor occupies the right-hand column. */
  activePanel: PanelId;
  canvasMode: CanvasMode;
  /** Drawable under the cursor while picking, for the overlay to outline. */
  hoveredDrawable: number | null;
  /** Result of the last hit-area test click, shown in the config panel. */
  lastHitTest: { areaName: string; drawableId: string } | null;
  /** Expression names currently applied to the preview, with blend weights. */
  activeExpressions: Record<string, number>;
  /** Expression the editor's parameter table is showing. */
  selectedExpression: string | null;
  /** Pose group whose members are being edited. */
  selectedPoseGroup: number | null;
  /** Physics chain whose pendulum is drawn on the model. */
  selectedPhysicsChain: number | null;

  setActivePanel(panel: PanelId): void;
  setExpressionWeight(name: string, weight: number): void;
  toggleExpression(name: string): void;
  clearExpressions(): void;
  selectExpression(name: string | null): void;
  selectPoseGroup(index: number | null): void;
  selectPhysicsChain(index: number | null): void;
  setCanvasMode(mode: CanvasMode): void;
  setHoveredDrawable(index: number | null): void;
  setLastHitTest(result: { areaName: string; drawableId: string } | null): void;
}

/**
 * Transient UI state: which panel is open, what is selected, what is being
 * previewed.
 *
 * Kept apart from the document stores because none of it belongs in a file and
 * none of it should be undoable — Ctrl+Z after clicking a different expression
 * should undo the last edit, not the selection.
 */
export const useEditorUiStore = create<EditorUiState>((set) => ({
  activePanel: 'parameters',
  activeExpressions: {},
  selectedExpression: null,
  selectedPoseGroup: null,
  selectedPhysicsChain: null,
  canvasMode: 'none',
  hoveredDrawable: null,
  lastHitTest: null,

  setActivePanel: (activePanel) => set({ activePanel }),

  setExpressionWeight: (name, weight) =>
    set((state) => ({
      activeExpressions: { ...state.activeExpressions, [name]: weight }
    })),

  toggleExpression: (name) =>
    set((state) => {
      const next = { ...state.activeExpressions };
      if (name in next) delete next[name];
      else next[name] = 1;
      return { activeExpressions: next };
    }),

  clearExpressions: () => set({ activeExpressions: {} }),

  selectExpression: (selectedExpression) => set({ selectedExpression }),

  selectPoseGroup: (selectedPoseGroup) => set({ selectedPoseGroup }),

  selectPhysicsChain: (selectedPhysicsChain) => set({ selectedPhysicsChain }),

  setCanvasMode: (canvasMode) =>
    // Leaving a picking mode must clear its transient feedback, or a stale
    // outline stays on the canvas after the mode ends.
    set({ canvasMode, hoveredDrawable: null, lastHitTest: null }),

  setHoveredDrawable: (hoveredDrawable) => set({ hoveredDrawable }),

  setLastHitTest: (lastHitTest) => set({ lastHitTest })
}));
