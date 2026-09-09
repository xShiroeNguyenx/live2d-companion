import { describe, expect, it } from 'vitest';
import {
  buildPartTree,
  collectPartDrawables
} from '../../src/renderer/core/cubism/ModelInfo';
import type { DrawableInfo, ModelInfo, PartInfo } from '../../src/renderer/core/cubism/ModelInfo';

function part(index: number, id: string, parentIndex: number): PartInfo {
  return { index, id, name: id, parentIndex };
}

function drawable(index: number, id: string, parentPartIndex: number): DrawableInfo {
  return { index, id, textureIndex: 0, parentPartIndex, vertexCount: 4 };
}

function modelInfo(parts: PartInfo[], drawables: DrawableInfo[]): ModelInfo {
  return {
    mocVersion: 3,
    latestSupportedMocVersion: 6,
    canvas: {
      widthPixel: 2048,
      heightPixel: 2048,
      originX: 1024,
      originY: 1024,
      pixelsPerUnit: 1024,
      widthUnit: 2,
      heightUnit: 2
    },
    parameters: [],
    parts,
    drawables,
    parameterGroups: [],
    usesMasking: false
  };
}

/**
 * A small stand-in for a real model's hierarchy:
 *
 *   Body (0)
 *     Clothing (1)          — jacket art
 *       Buttons (2)         — button art
 *     Skin (3)              — skin art
 *   Accessories (4)         — no art of its own
 *     Ribbon (5)            — ribbon art
 */
const parts = [
  part(0, 'PartBody', -1),
  part(1, 'PartClothing', 0),
  part(2, 'PartButtons', 1),
  part(3, 'PartSkin', 0),
  part(4, 'PartAccessories', -1),
  part(5, 'PartRibbon', 4)
];

const drawables = [
  drawable(0, 'Jacket', 1),
  drawable(1, 'JacketSleeve', 1),
  drawable(2, 'Button1', 2),
  drawable(3, 'Button2', 2),
  drawable(4, 'Arm', 3),
  drawable(5, 'Ribbon', 5)
];

const info = modelInfo(parts, drawables);

describe('collectPartDrawables', () => {
  it('includes drawables from nested child parts', () => {
    // Hiding the clothing must take its buttons with it, or they float in
    // mid-air over a bare torso.
    expect(collectPartDrawables(info, 1).sort()).toEqual([0, 1, 2, 3]);
  });

  it('returns only the part own drawables when it has no children', () => {
    expect(collectPartDrawables(info, 3)).toEqual([4]);
  });

  it('walks the whole subtree from a root part', () => {
    expect(collectPartDrawables(info, 0).sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('returns an empty list for a part that draws nothing itself', () => {
    // PartAccessories has no art of its own, only a child that does.
    expect(collectPartDrawables(info, 4)).toEqual([5]);
  });

  it('handles a part index that does not exist', () => {
    expect(collectPartDrawables(info, 99)).toEqual([]);
  });

  it('does not loop forever on a cyclic hierarchy', () => {
    // A malformed moc could describe a cycle; the walk must still terminate.
    const cyclic = modelInfo(
      [part(0, 'A', 1), part(1, 'B', 0)],
      [drawable(0, 'ArtA', 0), drawable(1, 'ArtB', 1)]
    );
    expect(collectPartDrawables(cyclic, 0).sort()).toEqual([0, 1]);
  });
});

describe('buildPartTree', () => {
  it('lists parts depth-first with their nesting level', () => {
    const tree = buildPartTree(info);
    expect(tree.map((node) => [node.part.id, node.depth])).toEqual([
      ['PartBody', 0],
      ['PartClothing', 1],
      ['PartButtons', 2],
      ['PartSkin', 1],
      ['PartAccessories', 0],
      ['PartRibbon', 1]
    ]);
  });

  it('counts drawables owned directly and in total', () => {
    const tree = buildPartTree(info);
    const clothing = tree.find((node) => node.part.id === 'PartClothing');
    expect(clothing).toMatchObject({ ownDrawableCount: 2, totalDrawableCount: 4 });

    const accessories = tree.find((node) => node.part.id === 'PartAccessories');
    // Draws nothing itself, but its child does — which is why the panel shows
    // both numbers rather than hiding the part as empty.
    expect(accessories).toMatchObject({ ownDrawableCount: 0, totalDrawableCount: 1 });
  });

  it('includes every part even when the hierarchy is broken', () => {
    // A part whose parent index points at nothing must not vanish from the list.
    const orphaned = modelInfo(
      [part(0, 'Root', -1), part(1, 'Orphan', 42)],
      [drawable(0, 'Art', 1)]
    );
    const tree = buildPartTree(orphaned);
    expect(tree.map((node) => node.part.id).sort()).toEqual(['Orphan', 'Root']);
  });

  it('returns an empty tree for a model with no parts', () => {
    expect(buildPartTree(modelInfo([], []))).toEqual([]);
  });
});
