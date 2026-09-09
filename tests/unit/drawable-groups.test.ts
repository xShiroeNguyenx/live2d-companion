import { describe, expect, it } from 'vitest';
import { buildDrawableGroups } from '../../src/renderer/core/cubism/ModelInfo';
import type { DrawableInfo, ModelInfo } from '../../src/renderer/core/cubism/ModelInfo';

/**
 * Grouping exists for models that give the mesh list no structure, so the
 * fixtures here are deliberately structureless: no parts, and — in the band
 * cases — no meaningful names either. `centreY` is what the grouping actually
 * reads, so each mesh is defined by where it sits rather than by its art.
 */
function drawable(index: number, id: string, centreY: number, height = 0.1): DrawableInfo {
  return {
    index,
    id,
    textureIndex: 0,
    parentPartIndex: -1,
    vertexCount: 4,
    bounds: { minX: -0.1, maxX: 0.1, minY: centreY - height / 2, maxY: centreY + height / 2 }
  };
}

function modelInfo(drawables: DrawableInfo[]): ModelInfo {
  return {
    mocVersion: 2,
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
    parts: [],
    drawables,
    parameterGroups: [],
    usesMasking: false,
    hasPartedDrawables: drawables.some((entry) => entry.parentPartIndex >= 0)
  };
}

describe('buildDrawableGroups', () => {
  it('groups by the author\'s own prefixes when the ids carry them', () => {
    const info = modelInfo([
      drawable(0, 'Hair_01', 0.6),
      drawable(1, 'Hair_02', 0.5),
      drawable(2, 'Skirt_01', -0.3),
      drawable(3, 'Skirt_02', -0.4)
    ]);

    const groups = buildDrawableGroups(info);

    expect(groups.map((group) => group.label)).toEqual(['Hair', 'Skirt']);
    expect(groups[0].drawables.map((entry) => entry.id)).toEqual(['Hair_01', 'Hair_02']);
  });

  it('falls back to vertical bands when every id shares one prefix', () => {
    // The exporter's own numbering — `ArtMesh1`…`ArtMeshN` — is the case that
    // makes name grouping useless, because it produces a single group holding
    // the entire model.
    const info = modelInfo([
      drawable(0, 'ArtMesh1', 0.9),
      drawable(1, 'ArtMesh2', 0.8),
      drawable(2, 'ArtMesh3', 0.5),
      drawable(3, 'ArtMesh4', -0.9)
    ]);

    const groups = buildDrawableGroups(info);

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every((group) => group.key.startsWith('band:'))).toBe(true);
    // Top-down, so the list reads the way the model looks.
    expect(groups[0].drawables[0].id).toBe('ArtMesh1');
  });

  it('separates hit areas from artwork', () => {
    const info = modelInfo([
      drawable(0, 'ArtMesh1', 0.5),
      drawable(1, 'ArtMesh2', -0.5),
      drawable(2, 'HitAreaHead', 0.6)
    ]);

    const groups = buildDrawableGroups(info);
    const hitArea = groups.find((group) => group.key === 'hit-areas');

    expect(hitArea?.drawables.map((entry) => entry.id)).toEqual(['HitAreaHead']);
    // And it must not also appear among the artwork.
    const artwork = groups.filter((group) => group.key !== 'hit-areas');
    expect(artwork.flatMap((group) => group.drawables.map((entry) => entry.id))).not.toContain(
      'HitAreaHead'
    );
  });

  it('accounts for every mesh exactly once', () => {
    const info = modelInfo([
      drawable(0, 'ArtMesh1', 0.9),
      drawable(1, 'ArtMesh2', 0.2),
      drawable(2, 'ArtMesh3', -0.6),
      drawable(3, 'HitAreaSkirt', -0.4)
    ]);

    const indices = buildDrawableGroups(info)
      .flatMap((group) => group.drawables.map((entry) => entry.index))
      .sort();

    expect(indices).toEqual([0, 1, 2, 3]);
  });

  it('does not divide by zero when every mesh sits at the origin', () => {
    const info = modelInfo([drawable(0, 'ArtMesh1', 0, 0), drawable(1, 'ArtMesh2', 0, 0)]);

    const groups = buildDrawableGroups(info);

    expect(groups).toHaveLength(1);
    expect(groups[0].drawables).toHaveLength(2);
  });

  it('returns nothing for a model with no meshes', () => {
    expect(buildDrawableGroups(modelInfo([]))).toEqual([]);
  });

  it('keeps bands balanced when the art is bunched at one height', () => {
    // The real failure this guards: Live2D models detail a face far more finely
    // than a skirt, so cutting by height put half the model in one group.
    const crowded = Array.from({ length: 90 }, (_, i) => drawable(i, `ArtMesh${i}`, 0.5 + i / 1000));
    const sparse = Array.from({ length: 10 }, (_, i) =>
      drawable(90 + i, `ArtMesh${90 + i}`, -0.5 + i / 100)
    );

    const groups = buildDrawableGroups(modelInfo([...crowded, ...sparse]));
    const largest = Math.max(...groups.map((group) => group.drawables.length));

    // Without count-based bands the top group would hold ~90 of the 100 meshes.
    expect(largest).toBeLessThanOrEqual(40);
  });

  it('does not split meshes that sit at the same height', () => {
    // A mirrored pair landing either side of a boundary is the one grouping
    // error a user would actually notice.
    const meshes = Array.from({ length: 20 }, (_, i) =>
      drawable(i, `ArtMesh${i}`, Math.floor(i / 2) / 10)
    );

    const groups = buildDrawableGroups(modelInfo(meshes));

    for (const group of groups) {
      const heights = new Set(group.drawables.map((entry) => entry.bounds.minY));
      for (const other of groups) {
        if (other === group) continue;
        for (const entry of other.drawables) {
          expect(heights.has(entry.bounds.minY)).toBe(false);
        }
      }
    }
  });
});
