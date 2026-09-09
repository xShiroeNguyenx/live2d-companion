import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { commandStack } from './commands/CommandStack';

enablePatches();

export interface DocumentState<T> {
  /** The document as it will be written to disk. */
  data: T;
  /** Relative path inside the workspace's `working/` directory. */
  relativePath: string | null;
}

export interface DocumentActions<T> {
  /** Loads a document from disk, clearing any edit history for this scope. */
  load(data: T, relativePath: string): void;
  unload(): void;
  /**
   * Applies a change and records it as one undoable command.
   *
   * @param label Shown in the undo tooltip.
   * @param recipe Mutates a draft of the document.
   * @param coalesceKey Merges consecutive changes sharing this key into one
   *   undo entry — pass a stable key while a drag gesture is in progress.
   */
  edit(label: string, recipe: (draft: T) => void, coalesceKey?: string): void;
}

export type DocumentStore<T> = UseBoundStore<
  StoreApi<DocumentState<T> & DocumentActions<T>>
>;

/**
 * Builds a store for one Live2D JSON document, wired into the global undo stack
 * and the autosave queue.
 *
 * Every editor panel in the app is a view over one of these: the JSON is the
 * single source of truth, edits are patches, and the runtime is rebuilt from the
 * JSON — which is what keeps the preview and the exported file identical.
 */
export function createDocumentStore<T>(scope: string, empty: T): DocumentStore<T> {
  const store = create<DocumentState<T> & DocumentActions<T>>((set, get) => ({
    data: empty,
    relativePath: null,

    load: (data, relativePath) => {
      set({ data, relativePath });
      onDocumentLoaded(scope);
    },

    unload: () => set({ data: empty, relativePath: null }),

    edit: (label, recipe, coalesceKey) => {
      const [next, patches, inversePatches] = produceWithPatches(get().data, recipe);
      if (patches.length === 0) return;

      set({ data: next });
      commandStack.push({ label, scope, patches, inversePatches, coalesceKey });
      onDocumentChanged(scope, get().relativePath, next);
    }
  }));

  // Undo/redo replays patches straight onto the document, bypassing `edit` so
  // reversing a change does not itself become a new undo entry.
  commandStack.registerScope(scope, (patches) => {
    const state = store.getState();
    const next = applyPatches(state.data as object, patches) as T;
    store.setState({ data: next });
    onDocumentChanged(scope, state.relativePath, next);
  });

  return store;
}

/** Hooks the document lifecycle up to autosave; set once at app start. */
let changeHandler: ((scope: string, relativePath: string | null, data: unknown) => void) | null =
  null;
let loadHandler: ((scope: string) => void) | null = null;

export function setDocumentHandlers(handlers: {
  onChanged(scope: string, relativePath: string | null, data: unknown): void;
  onLoaded(scope: string): void;
}): void {
  changeHandler = handlers.onChanged;
  loadHandler = handlers.onLoaded;
}

function onDocumentChanged(scope: string, relativePath: string | null, data: unknown): void {
  changeHandler?.(scope, relativePath, data);
}

function onDocumentLoaded(scope: string): void {
  loadHandler?.(scope);
}
