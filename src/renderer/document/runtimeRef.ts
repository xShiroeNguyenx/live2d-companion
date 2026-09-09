import type { EditorRuntime } from '../core/cubism/EditorRuntime';

/**
 * The one live runtime, shared by every panel.
 *
 * Panels read model state from the Zustand stores, but writing a parameter has
 * to reach the actual Cubism model, and that object cannot live in a store
 * (it holds native pointers and would be cloned or frozen). This is the seam.
 */
export const runtimeRef: { current: EditorRuntime | null } = { current: null };
