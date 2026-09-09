import type { CubismModel } from '@framework/model/cubismmodel';

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Picks drawables under a point in model space.
 *
 * Two different tests live here on purpose:
 *
 * - `pickDrawable` uses point-in-triangle, because assigning a hit area means
 *   clicking precisely on the art the user sees, and bounding boxes of
 *   overlapping meshes make that guesswork.
 * - `hitTestBounds` uses the bounding box, because that is what the runtime
 *   itself does (`CubismUserModel.isHit`). Testing a configured hit area has to
 *   report what will actually happen in a companion app or VTube Studio, not
 *   something more accurate.
 */
export class HitTester {
  constructor(private readonly model: CubismModel) {}

  /**
   * The topmost visible drawable containing the point, or null.
   *
   * "Topmost" follows the model's render order, so clicking overlapping hair and
   * face picks whichever the renderer draws last — the one the user can see.
   */
  pickDrawable(x: number, y: number): number | null {
    const renderOrders = this.model.getModel().getRenderOrders();
    let best: number | null = null;
    let bestOrder = -Infinity;

    for (let index = 0; index < this.model.getDrawableCount(); index += 1) {
      if (!this.model.getDrawableDynamicFlagIsVisible(index)) continue;
      // A fully transparent mesh is not something the user can click on.
      if (this.model.getDrawableOpacity(index) <= 0.01) continue;
      if (!this.containsPoint(index, x, y)) continue;

      const order = renderOrders[index] ?? 0;
      if (order > bestOrder) {
        bestOrder = order;
        best = index;
      }
    }
    return best;
  }

  /** Every visible drawable containing the point, topmost first. */
  pickAllDrawables(x: number, y: number): number[] {
    const renderOrders = this.model.getModel().getRenderOrders();
    const hits: Array<{ index: number; order: number }> = [];

    for (let index = 0; index < this.model.getDrawableCount(); index += 1) {
      if (!this.model.getDrawableDynamicFlagIsVisible(index)) continue;
      if (this.model.getDrawableOpacity(index) <= 0.01) continue;
      if (this.containsPoint(index, x, y)) {
        hits.push({ index, order: renderOrders[index] ?? 0 });
      }
    }

    return hits.sort((a, b) => b.order - a.order).map((hit) => hit.index);
  }

  /**
   * Bounding-box test, matching how the runtime resolves a tap on a hit area.
   *
   * Deliberately the looser test: a hit area is a tap target, and both the
   * framework and downstream runtimes only compare against the mesh's box.
   */
  hitTestBounds(drawableIndex: number, x: number, y: number): boolean {
    const bounds = this.getBounds(drawableIndex);
    if (!bounds) return false;
    return (
      x >= bounds.left && x <= bounds.right && y >= bounds.bottom && y <= bounds.top
    );
  }

  /** Axis-aligned bounds of a drawable in model space, for drawing overlays. */
  getBounds(drawableIndex: number): Bounds | null {
    const count = this.model.getDrawableVertexCount(drawableIndex);
    if (count === 0) return null;

    const vertices = this.model.getDrawableVertices(drawableIndex);
    let left = vertices[0];
    let right = vertices[0];
    let bottom = vertices[1];
    let top = vertices[1];

    for (let vertex = 1; vertex < count; vertex += 1) {
      const x = vertices[vertex * 2];
      const y = vertices[vertex * 2 + 1];
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < bottom) bottom = y;
      if (y > top) top = y;
    }

    return { left, right, top, bottom };
  }

  /** True when the point falls inside any triangle of the drawable's mesh. */
  private containsPoint(drawableIndex: number, x: number, y: number): boolean {
    // Reject on the cheap box test first; most meshes fail here.
    const bounds = this.getBounds(drawableIndex);
    if (
      !bounds ||
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.bottom ||
      y > bounds.top
    ) {
      return false;
    }

    const vertices = this.model.getDrawableVertices(drawableIndex);
    const indices = this.model.getDrawableVertexIndices(drawableIndex);

    for (let triangle = 0; triangle + 2 < indices.length; triangle += 3) {
      const a = indices[triangle] * 2;
      const b = indices[triangle + 1] * 2;
      const c = indices[triangle + 2] * 2;
      if (
        pointInTriangle(
          x,
          y,
          vertices[a],
          vertices[a + 1],
          vertices[b],
          vertices[b + 1],
          vertices[c],
          vertices[c + 1]
        )
      ) {
        return true;
      }
    }
    return false;
  }
}

/**
 * Point-in-triangle by edge sign, tolerant of winding order.
 *
 * Live2D meshes are not consistently wound, so a test that assumed one
 * direction would miss roughly half the triangles.
 */
export function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const d1 = edgeSign(px, py, ax, ay, bx, by);
  const d2 = edgeSign(px, py, bx, by, cx, cy);
  const d3 = edgeSign(px, py, cx, cy, ax, ay);

  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  // Inside means every edge test agrees on a side; a zero lies on an edge.
  return !(hasNegative && hasPositive);
}

function edgeSign(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}
