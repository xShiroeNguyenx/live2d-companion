import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import { CommandStack } from '../../src/renderer/document/commands/CommandStack';

enablePatches();

/** A stand-in document store: holds state and applies patches to it. */
function makeScope<T extends object>(stack: CommandStack, scope: string, initial: T) {
  let state = initial;
  stack.registerScope(scope, (patches) => {
    state = applyPatches(state, patches) as T;
  });
  return {
    get current(): T {
      return state;
    },
    edit(label: string, recipe: (draft: T) => void, coalesceKey?: string): void {
      const [next, patches, inversePatches] = produceWithPatches(state, recipe);
      state = next;
      stack.push({ label, scope, patches, inversePatches, coalesceKey });
    }
  };
}

describe('CommandStack', () => {
  let stack: CommandStack;

  beforeEach(() => {
    stack = new CommandStack();
    vi.useRealTimers();
  });

  it('undoes and redoes a single edit', () => {
    const doc = makeScope(stack, 'physics3', { swing: 1 });

    doc.edit('Sửa độ lắc', (draft) => {
      draft.swing = 5;
    });
    expect(doc.current.swing).toBe(5);

    stack.undo();
    expect(doc.current.swing).toBe(1);

    stack.redo();
    expect(doc.current.swing).toBe(5);
  });

  it('reports what undo and redo would do', () => {
    const doc = makeScope(stack, 'pose3', { fade: 0.5 });
    expect(stack.snapshot()).toMatchObject({ canUndo: false, canRedo: false });

    doc.edit('Sửa fade', (draft) => {
      draft.fade = 1;
    });
    expect(stack.snapshot()).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: 'Sửa fade'
    });

    stack.undo();
    expect(stack.snapshot()).toMatchObject({
      canUndo: false,
      canRedo: true,
      redoLabel: 'Sửa fade'
    });
  });

  it('undoes a whole drag gesture at once when commands share a coalesce key', () => {
    const doc = makeScope(stack, 'physics3', { swing: 0 });

    // What a slider drag produces: one command per pointer-move.
    for (const value of [1, 2, 3, 4, 5]) {
      doc.edit(
        'Sửa độ lắc',
        (draft) => {
          draft.swing = value;
        },
        'physics:swing'
      );
    }
    expect(doc.current.swing).toBe(5);

    stack.undo();
    // The whole gesture reverses, not just its last step.
    expect(doc.current.swing).toBe(0);
    expect(stack.snapshot().canUndo).toBe(false);

    stack.redo();
    expect(doc.current.swing).toBe(5);
  });

  it('keeps separate gestures as separate undo entries', () => {
    const doc = makeScope(stack, 'physics3', { swing: 0, stiffness: 0 });

    doc.edit('Sửa độ lắc', (draft) => {
      draft.swing = 5;
    }, 'physics:swing');
    doc.edit('Sửa độ cứng', (draft) => {
      draft.stiffness = 3;
    }, 'physics:stiffness');

    stack.undo();
    expect(doc.current).toEqual({ swing: 5, stiffness: 0 });
    stack.undo();
    expect(doc.current).toEqual({ swing: 0, stiffness: 0 });
  });

  it('does not coalesce gestures separated by a pause', async () => {
    vi.useFakeTimers();
    const doc = makeScope(stack, 'physics3', { swing: 0 });

    doc.edit('Sửa độ lắc', (draft) => {
      draft.swing = 3;
    }, 'physics:swing');

    // Longer than the coalesce window: a new gesture, so a new undo entry.
    vi.advanceTimersByTime(2000);

    doc.edit('Sửa độ lắc', (draft) => {
      draft.swing = 7;
    }, 'physics:swing');

    stack.undo();
    expect(doc.current.swing).toBe(3);
  });

  it('drops the redo branch once new work happens', () => {
    const doc = makeScope(stack, 'pose3', { fade: 0 });

    doc.edit('A', (draft) => {
      draft.fade = 1;
    });
    stack.undo();
    expect(stack.snapshot().canRedo).toBe(true);

    doc.edit('B', (draft) => {
      draft.fade = 2;
    });
    expect(stack.snapshot().canRedo).toBe(false);
    expect(doc.current.fade).toBe(2);
  });

  it('tracks dirtiness against the last save', () => {
    const doc = makeScope(stack, 'pose3', { fade: 0 });
    expect(stack.snapshot().isDirty).toBe(false);

    doc.edit('Sửa fade', (draft) => {
      draft.fade = 1;
    });
    expect(stack.snapshot().isDirty).toBe(true);

    stack.markSaved();
    expect(stack.snapshot().isDirty).toBe(false);

    // Undoing back past the save point is a change relative to disk.
    stack.undo();
    expect(stack.snapshot().isDirty).toBe(true);
  });

  it('ignores an edit for a scope with no applier registered', () => {
    // A stale command from a previously open model must not throw.
    stack.push({ label: 'orphan', scope: 'gone', patches: [], inversePatches: [] });
    expect(stack.undo()).toBeNull();
  });

  it('clears history on reset', () => {
    const doc = makeScope(stack, 'pose3', { fade: 0 });
    doc.edit('Sửa fade', (draft) => {
      draft.fade = 1;
    });

    stack.reset();
    expect(stack.snapshot()).toMatchObject({
      canUndo: false,
      canRedo: false,
      isDirty: false
    });
  });

  it('keeps dirty tracking correct after the history cap evicts entries', () => {
    const doc = makeScope(stack, 'pose3', { fade: 0 });

    // Fill well past the 200-entry cap with distinct (non-coalescing) edits.
    for (let index = 1; index <= 250; index += 1) {
      doc.edit(`edit ${index}`, (draft) => {
        draft.fade = index;
      });
    }
    stack.markSaved();
    expect(stack.snapshot().isDirty).toBe(false);

    stack.undo();
    expect(stack.snapshot().isDirty).toBe(true);
  });
});
