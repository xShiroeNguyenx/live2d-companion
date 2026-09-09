import { useEffect, useState } from 'react';
import { commandStack, type CommandStackSnapshot } from '../document/commands/CommandStack';
import { autosave, type SaveStatus } from '../document/autosave';

/** Subscribes a component to undo/redo availability and labels. */
export function useCommandStack(): CommandStackSnapshot {
  const [snapshot, setSnapshot] = useState<CommandStackSnapshot>(() =>
    commandStack.snapshot()
  );
  useEffect(() => commandStack.subscribe(setSnapshot), []);
  return snapshot;
}

/** Subscribes a component to the autosave indicator. */
export function useSaveStatus(): { status: SaveStatus; error?: string } {
  const [state, setState] = useState<{ status: SaveStatus; error?: string }>(() => ({
    status: autosave.getStatus()
  }));
  useEffect(
    () => autosave.subscribe((status, error) => setState({ status, error })),
    []
  );
  return state;
}

/**
 * Wires Ctrl+Z / Ctrl+Shift+Z (and Ctrl+Y) to the global stack.
 *
 * Bound on the window rather than per-panel because the stack is global: undo
 * should mean "undo my last edit" no matter which panel has focus.
 */
export function useUndoRedoShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;

      // Never steal the shortcut from a field the user is typing in.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        commandStack.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        commandStack.redo();
      } else if (key === 's') {
        // Autosave already handles persistence; Ctrl+S just flushes it now.
        event.preventDefault();
        void autosave.flush();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
