import { describe, expect, it } from 'vitest';
import {
  ancestorParts,
  descendantParts
} from '../../src/renderer/core/cubism/ModelInfo';
import type { ModelInfo, PartInfo } from '../../src/renderer/core/cubism/ModelInfo';

function part(index: number, id: string, parentIndex: number): PartInfo {
  return { index, id, name: id, parentIndex };
}

function modelInfo(parts: PartInfo[]): ModelInfo {
  return {
    mocVersion: 5,
    latestSupportedMocVersion: 6,
    canvas: {
      widthPixel: 5000,
      heightPixel: 8800,
      originX: 2500,
      originY: 4400,
      pixelsPerUnit: 1024,
      widthUnit: 4.88,
      heightUnit: 8.59
    },
    parameters: [],
    parts,
    drawables: [],
    parameterGroups: [],
    usesMasking: true
  };
}

/**
 * A hierarchy shaped like a PSD imported with nested folders — six levels deep,
 * which is what exposed the opacity bug: writing a dim value to every part in
 * the chain multiplied down to near-zero and the model vanished.
 *
 *   psd (0)
 *     Folder15 (1)
 *       hair (2)
 *         side L (3)
 *           strandA (4)
 *             tip (5)
 *       outfit (6)
 *   MODEL (7)          — a second root, as the real model has
 *     HAT (8)
 */
const parts = [
  part(0, 'psd', -1),
  part(1, 'Folder15', 0),
  part(2, 'hair', 1),
  part(3, 'sideL', 2),
  part(4, 'strandA', 3),
  part(5, 'tip', 4),
  part(6, 'outfit', 1),
  part(7, 'MODEL', -1),
  part(8, 'HAT', 7)
];

const info = modelInfo(parts);

/**
 * The selection rule from EditorRuntime.applyPartVisibility.
 *
 * Extracted here because it is the part that was wrong, and because getting it
 * right depends only on the hierarchy — no GL context needed to check it.
 */
function partsToDim(target: number): number[] {
  const keepVisible = new Set(descendantParts(info, target));
  for (const ancestor of ancestorParts(info, target)) keepVisible.add(ancestor);

  return info.parts
    .filter((candidate) => {
      if (keepVisible.has(candidate.index)) return false;
      // Only the topmost part of a dimmed subtree is written to; descendants
      // inherit the opacity, and writing to them too would multiply it.
      if (candidate.parentIndex >= 0 && !keepVisible.has(candidate.parentIndex)) {
        return false;
      }
      return true;
    })
    .map((candidate) => candidate.index);
}

describe('ancestorParts', () => {
  it('walks from a deep part up to its root', () => {
    expect(ancestorParts(info, 5)).toEqual([4, 3, 2, 1, 0]);
  });

  it('returns nothing for a root part', () => {
    expect(ancestorParts(info, 0)).toEqual([]);
  });

  it('terminates on a cyclic hierarchy', () => {
    const cyclic = modelInfo([part(0, 'A', 1), part(1, 'B', 0)]);
    expect(ancestorParts(cyclic, 0).length).toBeLessThanOrEqual(2);
  });
});

describe('part dimming selection', () => {
  it('never dims an ancestor of the isolated part', () => {
    // Dimming a parent would dim the isolated part through inheritance, which is
    // exactly how the model ended up invisible.
    const dimmed = new Set(partsToDim(5));
    for (const ancestor of ancestorParts(info, 5)) {
      expect(dimmed.has(ancestor)).toBe(false);
    }
  });

  it('never dims the isolated part or its descendants', () => {
    const dimmed = new Set(partsToDim(2));
    for (const descendant of descendantParts(info, 2)) {
      expect(dimmed.has(descendant)).toBe(false);
    }
  });

  it('writes to at most one part per dimmed chain', () => {
    // If both a part and its parent were dimmed, the opacities would multiply.
    const dimmed = partsToDim(5);
    for (const index of dimmed) {
      const ancestors = ancestorParts(info, index);
      for (const ancestor of ancestors) {
        expect(dimmed).not.toContain(ancestor);
      }
    }
  });

  it('dims the other root of a multi-root model', () => {
    // The reported model has two roots; isolating inside one must still fade the
    // other, or half the model stays at full brightness.
    expect(partsToDim(5)).toContain(7);
  });

  it('dims a sibling subtree at its top only', () => {
    const dimmed = partsToDim(5);
    // "outfit" is a sibling of the isolated chain and has no children here.
    expect(dimmed).toContain(6);
    // "HAT" sits under the dimmed MODEL root, so it must not be written to.
    expect(dimmed).not.toContain(8);
  });

  it('dims nothing when the isolated part is the only root', () => {
    const single = modelInfo([part(0, 'root', -1), part(1, 'child', 0)]);
    const keepVisible = new Set(descendantParts(single, 0));
    const dimmed = single.parts.filter(
      (candidate) =>
        !keepVisible.has(candidate.index) &&
        (candidate.parentIndex < 0 || keepVisible.has(candidate.parentIndex))
    );
    expect(dimmed).toEqual([]);
  });
});

describe('hiding a part', () => {
  it('needs only the top part zeroed, since children inherit it', () => {
    // Hiding "hair" must not also write to sideL/strandA/tip: the visible result
    // is the same and writing to each would be redundant work per frame.
    const subtree = descendantParts(info, 2);
    expect(subtree).toContain(3);
    expect(subtree).toContain(5);
    // The contract the runtime relies on: the subtree is known, so one write at
    // its root is enough.
    expect(subtree[0]).toBe(2);
  });
});
