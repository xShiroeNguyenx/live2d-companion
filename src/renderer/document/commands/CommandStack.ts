import type { Patch } from 'immer';

/**
 * One undoable change to one document.
 *
 * Commands carry immer patches rather than whole-document snapshots so that a
 * long editing session does not retain a copy of every intermediate state of a
 * multi-megabyte motion file.
 */
export interface Command {
  /** Shown in the undo tooltip, e.g. "Sửa physics: độ lắc". */
  label: string;
  /** Which document store the patches apply to. */
  scope: string;
  patches: Patch[];
  inversePatches: Patch[];
  /**
   * Continuous gestures (dragging a slider, dragging a keyframe) push a command
   * per pointer-move. Commands sharing a coalesce key merge into one undo entry
   * so a single drag is a single Ctrl+Z.
   */
  coalesceKey?: string;
  at: number;
}

export interface CommandStackSnapshot {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  /** Position in the stack, compared against the last-saved marker for dirtiness. */
  version: number;
  isDirty: boolean;
}

/** Applies patches to a store. Registered per document scope. */
export type PatchApplier = (patches: Patch[]) => void;

const MAX_ENTRIES = 200;
/** Gestures separated by more than this start a new undo entry. */
const COALESCE_WINDOW_MS = 800;

/**
 * A single global undo timeline shared by every panel.
 *
 * One stack rather than one per panel is a deliberate choice: for a
 * non-technical user, Ctrl+Z meaning "undo the last thing I did" is far less
 * surprising than an undo whose effect depends on which panel has focus.
 */
export class CommandStack {
  private entries: Command[] = [];
  /** Index of the next redo entry; everything before it is applied. */
  private cursor = 0;
  private savedCursor = 0;
  private appliers = new Map<string, PatchApplier>();
  private listeners = new Set<(snapshot: CommandStackSnapshot) => void>();

  /** Registers how to apply patches for a document scope. */
  registerScope(scope: string, applier: PatchApplier): void {
    this.appliers.set(scope, applier);
  }

  unregisterScope(scope: string): void {
    this.appliers.delete(scope);
  }

  subscribe(listener: (snapshot: CommandStackSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): CommandStackSnapshot {
    const undoEntry = this.cursor > 0 ? this.entries[this.cursor - 1] : null;
    const redoEntry = this.cursor < this.entries.length ? this.entries[this.cursor] : null;
    return {
      canUndo: undoEntry !== null,
      canRedo: redoEntry !== null,
      undoLabel: undoEntry?.label ?? null,
      redoLabel: redoEntry?.label ?? null,
      version: this.cursor,
      isDirty: this.cursor !== this.savedCursor
    };
  }

  /**
   * Records a change that has already been applied to its store.
   *
   * The caller applies first and records second, so the UI never waits on the
   * stack; the stack only needs to know how to reverse what happened.
   */
  push(command: Omit<Command, 'at'>): void {
    const entry: Command = { ...command, at: Date.now() };

    // A redo branch is abandoned as soon as new work happens.
    if (this.cursor < this.entries.length) {
      this.entries.length = this.cursor;
    }

    const previous = this.entries[this.entries.length - 1];
    if (
      previous &&
      entry.coalesceKey &&
      previous.coalesceKey === entry.coalesceKey &&
      previous.scope === entry.scope &&
      entry.at - previous.at < COALESCE_WINDOW_MS
    ) {
      // Extend the existing entry: forward patches append in order, inverse
      // patches prepend so undoing walks back to the gesture's starting state.
      previous.patches.push(...entry.patches);
      previous.inversePatches.unshift(...entry.inversePatches);
      previous.at = entry.at;
      this.notify();
      return;
    }

    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      const dropped = this.entries.length - MAX_ENTRIES;
      this.entries.splice(0, dropped);
      // Both markers shift with the window so dirty tracking stays correct.
      this.savedCursor = Math.max(0, this.savedCursor - dropped);
    }
    this.cursor = this.entries.length;
    this.notify();
  }

  undo(): Command | null {
    if (this.cursor === 0) return null;
    const entry = this.entries[this.cursor - 1];
    const applier = this.appliers.get(entry.scope);
    if (!applier) return null;

    applier(entry.inversePatches);
    this.cursor -= 1;
    this.notify();
    return entry;
  }

  redo(): Command | null {
    if (this.cursor >= this.entries.length) return null;
    const entry = this.entries[this.cursor];
    const applier = this.appliers.get(entry.scope);
    if (!applier) return null;

    applier(entry.patches);
    this.cursor += 1;
    this.notify();
    return entry;
  }

  /** Called after a successful save so dirty state reflects what is on disk. */
  markSaved(): void {
    this.savedCursor = this.cursor;
    this.notify();
  }

  /** Wipes history, e.g. when a different model is opened. */
  reset(): void {
    this.entries = [];
    this.cursor = 0;
    this.savedCursor = 0;
    this.notify();
  }

  private notify(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** The app's single stack. */
export const commandStack = new CommandStack();
