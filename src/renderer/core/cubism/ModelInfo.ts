import type { CubismModel } from '@framework/model/cubismmodel';
import type { Cdi3Json } from '@shared/types/live2d-files';

/**
 * An immutable snapshot of everything the moc3 declares.
 *
 * The editor cannot change any of this — parameters, parts and drawables are
 * baked into the compiled moc — so it is read once at load and then treated as
 * the authority every panel validates against.
 */
export interface ParameterInfo {
  index: number;
  id: string;
  /** Display name from cdi3.json, falling back to the raw id. */
  name: string;
  groupId: string;
  minimum: number;
  maximum: number;
  default: number;
  /** True for Cubism 5 blend-shape parameters, which behave additively. */
  isBlendShape: boolean;
  /** The model author marked this parameter as wrapping rather than clamping. */
  repeats: boolean;
}

export interface PartInfo {
  index: number;
  id: string;
  name: string;
  parentIndex: number;
}

export interface DrawableInfo {
  index: number;
  id: string;
  textureIndex: number;
  parentPartIndex: number;
  vertexCount: number;
  /**
   * The mesh's extent in model units, at the resting pose.
   *
   * Kept because it is the only handle on *where* a mesh sits when the model
   * gives no other clue — a moc with no part assignments whose meshes are named
   * `ArtMesh204` offers nothing else to group or sort by. Read once at load:
   * the numbers move as parameters animate, but the resting pose is a stable
   * enough basis for "this one is on the head".
   */
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface ParameterGroupInfo {
  id: string;
  name: string;
  parameterIndices: number[];
}

export interface ModelInfo {
  mocVersion: number;
  latestSupportedMocVersion: number;
  canvas: {
    widthPixel: number;
    heightPixel: number;
    originX: number;
    originY: number;
    pixelsPerUnit: number;
    /** Canvas size in model units — what the MVP matrix works in. */
    widthUnit: number;
    heightUnit: number;
  };
  parameters: ParameterInfo[];
  parts: PartInfo[];
  drawables: DrawableInfo[];
  /** Parameter groups declared by cdi3.json, for organising the slider list. */
  parameterGroups: ParameterGroupInfo[];
  usesMasking: boolean;
  /**
   * Whether any mesh is actually assigned to a part.
   *
   * False for mocs exported by Cubism 3.0 (moc version 2) and for models whose
   * author left every mesh at the root: the part list still exists, but it
   * describes empty folders. Anything that offers "hide this part" has to fall
   * back to per-mesh work when this is false, or it presents a list of controls
   * that cannot move anything.
   */
  hasPartedDrawables: boolean;
}

/**
 * Reads the moc's declarations straight off the Core's typed arrays.
 *
 * We go through `model.getModel()` rather than the framework's per-index
 * getters because the raw arrays give us parameter types and repeat flags in
 * one pass, and because an editor needs UVs and indices for texture masking.
 */
export function buildModelInfo(
  model: CubismModel,
  mocVersion: number,
  displayInfo?: Cdi3Json | null
): ModelInfo {
  const core = model.getModel();
  const coreParameters = core.parameters;
  const coreParts = core.parts;
  const coreDrawables = core.drawables;
  const canvas = core.canvasinfo;

  const parameterNames = new Map<string, { name: string; groupId: string }>();
  for (const entry of displayInfo?.Parameters ?? []) {
    parameterNames.set(entry.Id, { name: entry.Name, groupId: entry.GroupId });
  }
  const partNames = new Map<string, string>();
  for (const entry of displayInfo?.Parts ?? []) {
    partNames.set(entry.Id, entry.Name);
  }

  const parameters: ParameterInfo[] = [];
  for (let index = 0; index < coreParameters.count; index += 1) {
    const id = coreParameters.ids[index];
    const display = parameterNames.get(id);
    parameters.push({
      index,
      id,
      name: display?.name ?? id,
      groupId: display?.groupId ?? '',
      minimum: coreParameters.minimumValues[index],
      maximum: coreParameters.maximumValues[index],
      default: coreParameters.defaultValues[index],
      isBlendShape:
        coreParameters.types[index] === Live2DCubismCore.ParameterType_BlendShape,
      repeats: coreParameters.repeats[index] !== 0
    });
  }

  const parts: PartInfo[] = [];
  for (let index = 0; index < coreParts.count; index += 1) {
    const id = coreParts.ids[index];
    parts.push({
      index,
      id,
      name: partNames.get(id) ?? id,
      parentIndex: coreParts.parentIndices[index]
    });
  }

  const drawables: DrawableInfo[] = [];
  for (let index = 0; index < coreDrawables.count; index += 1) {
    drawables.push({
      index,
      id: coreDrawables.ids[index],
      textureIndex: coreDrawables.textureIndices[index],
      parentPartIndex: coreDrawables.parentPartIndices[index],
      vertexCount: coreDrawables.vertexCounts[index],
      bounds: meshBounds(coreDrawables.vertexPositions[index])
    });
  }

  return {
    mocVersion,
    latestSupportedMocVersion: Live2DCubismCore.Version.csmGetLatestMocVersion(),
    canvas: {
      widthPixel: canvas.CanvasWidth,
      heightPixel: canvas.CanvasHeight,
      originX: canvas.CanvasOriginX,
      originY: canvas.CanvasOriginY,
      pixelsPerUnit: canvas.PixelsPerUnit,
      widthUnit: model.getCanvasWidth(),
      heightUnit: model.getCanvasHeight()
    },
    parameters,
    parts,
    drawables,
    parameterGroups: buildParameterGroups(parameters, displayInfo),
    usesMasking: model.isUsingMasking(),
    hasPartedDrawables: drawables.some((drawable) => drawable.parentPartIndex >= 0)
  };
}

/**
 * The rectangle a mesh occupies, from its flat [x, y, x, y, …] vertex array.
 *
 * An empty mesh collapses to the origin rather than to ±Infinity, so callers can
 * sort and bucket without special-casing it.
 */
function meshBounds(positions: Float32Array | undefined): DrawableInfo['bounds'] {
  if (!positions || positions.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < positions.length; i += 2) {
    const x = positions[i];
    const y = positions[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function buildParameterGroups(
  parameters: ParameterInfo[],
  displayInfo?: Cdi3Json | null
): ParameterGroupInfo[] {
  const groupNames = new Map<string, string>();
  for (const group of displayInfo?.ParameterGroups ?? []) {
    groupNames.set(group.Id, group.Name);
  }

  const byGroup = new Map<string, number[]>();
  for (const parameter of parameters) {
    const key = parameter.groupId || '';
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(parameter.index);
    else byGroup.set(key, [parameter.index]);
  }

  const groups: ParameterGroupInfo[] = [];
  for (const [id, parameterIndices] of byGroup) {
    groups.push({
      id,
      name: id === '' ? 'Khác' : (groupNames.get(id) ?? id),
      parameterIndices
    });
  }

  // Ungrouped parameters go last so named groups lead the panel.
  return groups.sort((a, b) => {
    if (a.id === '') return 1;
    if (b.id === '') return -1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Every drawable that belongs to a part, including through nested child parts.
 *
 * Needed because parts form a tree: hiding "clothing" should hide the jacket and
 * its buttons, which are separate drawables hanging off child parts. Walking
 * only the direct children would leave pieces floating in mid-air.
 */
export function collectPartDrawables(info: ModelInfo, partIndex: number): number[] {
  const descendants = new Set<number>([partIndex]);

  // Parts are stored parent-before-child, so a single forward pass closes the
  // set without recursion.
  let grew = true;
  while (grew) {
    grew = false;
    for (const part of info.parts) {
      if (!descendants.has(part.index) && descendants.has(part.parentIndex)) {
        descendants.add(part.index);
        grew = true;
      }
    }
  }

  return info.drawables
    .filter((drawable) => descendants.has(drawable.parentPartIndex))
    .map((drawable) => drawable.index);
}

/**
 * Parts that own at least one drawable, as a tree ordered for display.
 *
 * A model's part list includes organisational parts that draw nothing, which
 * only add noise to a list whose purpose is "pick the thing you can see".
 */
export interface PartTreeNode {
  part: PartInfo;
  depth: number;
  /** Drawables under this part alone, not counting descendants. */
  ownDrawableCount: number;
  /** Drawables under this part and everything below it. */
  totalDrawableCount: number;
}

export function buildPartTree(info: ModelInfo): PartTreeNode[] {
  const childrenOf = new Map<number, PartInfo[]>();
  for (const part of info.parts) {
    const list = childrenOf.get(part.parentIndex);
    if (list) list.push(part);
    else childrenOf.set(part.parentIndex, [part]);
  }

  const ownCounts = new Map<number, number>();
  for (const drawable of info.drawables) {
    ownCounts.set(
      drawable.parentPartIndex,
      (ownCounts.get(drawable.parentPartIndex) ?? 0) + 1
    );
  }

  const nodes: PartTreeNode[] = [];
  const visit = (part: PartInfo, depth: number): void => {
    nodes.push({
      part,
      depth,
      ownDrawableCount: ownCounts.get(part.index) ?? 0,
      totalDrawableCount: collectPartDrawables(info, part.index).length
    });
    for (const child of childrenOf.get(part.index) ?? []) visit(child, depth + 1);
  };

  // -1 is the root marker the Core uses for a part with no parent.
  for (const root of childrenOf.get(-1) ?? []) visit(root, 0);

  // A malformed hierarchy could leave parts unvisited; append them rather than
  // dropping them, so the list always accounts for every part in the model.
  const seen = new Set(nodes.map((node) => node.part.index));
  for (const part of info.parts) {
    if (!seen.has(part.index)) {
      nodes.push({
        part,
        depth: 0,
        ownDrawableCount: ownCounts.get(part.index) ?? 0,
        totalDrawableCount: collectPartDrawables(info, part.index).length
      });
    }
  }

  return nodes;
}

/**
 * A part together with every part nested under it.
 *
 * Used wherever an action on a part has to apply to what it contains — hiding
 * clothing, isolating a region, previewing a pose member.
 */
export function descendantParts(info: ModelInfo, partIndex: number): number[] {
  const descendants = new Set<number>([partIndex]);

  let grew = true;
  while (grew) {
    grew = false;
    for (const part of info.parts) {
      if (!descendants.has(part.index) && descendants.has(part.parentIndex)) {
        descendants.add(part.index);
        grew = true;
      }
    }
  }
  return [...descendants];
}

/**
 * The chain of parts above a part, nearest ancestor first.
 *
 * Needed because part opacity multiplies down the hierarchy: to make one part
 * stand out, its ancestors have to stay at full opacity too, or the parent's
 * dimming is inherited by the very part being highlighted.
 */
export function ancestorParts(info: ModelInfo, partIndex: number): number[] {
  const chain: number[] = [];
  const seen = new Set<number>([partIndex]);

  let current = info.parts[partIndex]?.parentIndex ?? -1;
  while (current >= 0 && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = info.parts[current]?.parentIndex ?? -1;
  }
  return chain;
}

/**
 * Drawables owned directly by a part, not by its children.
 *
 * The part list is what users navigate, but many models attach a dozen separate
 * garments straight to one part rather than giving each its own — so hiding the
 * part takes them all. Listing a part's own meshes is what lets the panel offer
 * one row per garment.
 */
export function directDrawables(info: ModelInfo, partIndex: number): DrawableInfo[] {
  return info.drawables.filter((drawable) => drawable.parentPartIndex === partIndex);
}


/**
 * A bucket of meshes presented as one collapsible row.
 *
 * Only used for models that give the mesh list no structure of its own; see
 * {@link buildDrawableGroups}.
 */
export interface DrawableGroup {
  key: string;
  /** Shown on the group header. */
  label: string;
  drawables: DrawableInfo[];
}

/** Meshes whose id marks them as a hit area rather than artwork. */
const HIT_AREA_PREFIX = 'HitArea';

/**
 * Splits an id into a leading word and a trailing number, e.g. `Hair_03`.
 *
 * Returns null when the id is all one token, so the caller can tell "the author
 * named things" from "the exporter numbered things".
 */
function splitNamePrefix(id: string): string | null {
  const match = /^(.*?)[ _-]*[0-9]+$/.exec(id);
  const prefix = (match ? match[1] : id).trim();
  return prefix === '' ? null : prefix;
}

/**
 * Vertical bands used to group meshes on a model that provides no names.
 *
 * The labels describe a body because that is how a user thinks about finding
 * a garment, but the cuts are made on **how many meshes** fall above a line,
 * not on the height of the model. Live2D art is not spread evenly: a face is
 * modelled far more finely than a skirt, so one real model puts 186 of its 379
 * meshes in the top quarter of its own bounding box. Splitting by height there
 * yields a "head" group nearly half the size of the whole list — exactly the
 * unscannable list the grouping exists to break up. Splitting by count keeps
 * every group navigable whatever the model does.
 *
 * The bands stay coarse on purpose: a mesh landing one band off is a small
 * annoyance, while narrow bands would scatter a single garment across three
 * groups.
 */
const BODY_BANDS: ReadonlyArray<{ key: string; label: string; share: number }> = [
  { key: 'head', label: 'Phần trên (đầu, tóc, mặt)', share: 0.3 },
  { key: 'upper', label: 'Thân trên', share: 0.3 },
  { key: 'waist', label: 'Ngang hông', share: 0.2 },
  { key: 'lower', label: 'Phần dưới', share: 0.2 }
];

/**
 * Groups a flat mesh list into something a person can navigate.
 *
 * Needed because a model can hand us several hundred meshes with no part
 * assignments at all — every moc exported by Cubism 3.0 does, and so does any
 * model whose author never sorted meshes into folders. The part tree is the
 * usual way to navigate, and when it is empty the only alternative on offer is
 * one flat list of `ArtMesh1`…`ArtMesh387`, which is not a list anyone can
 * find a jacket in.
 *
 * Two strategies, chosen by what the model actually provides:
 *
 * - **By name**, when the ids carry a shared prefix (`Hair_01`, `Hair_02`).
 *   The author's own naming beats anything we could infer.
 * - **By vertical band**, when they do not. Position is the one signal a moc
 *   always has, and "which meshes are around the head" is the question a user
 *   is actually asking when they hunt for a hat.
 *
 * Hit areas are split off either way: they are invisible collision rectangles,
 * so hiding one does nothing on screen and their presence in a garment list is
 * pure noise.
 */
export function buildDrawableGroups(
  info: ModelInfo,
  drawables: DrawableInfo[] = info.drawables
): DrawableGroup[] {
  const artwork: DrawableInfo[] = [];
  const hitAreas: DrawableInfo[] = [];
  for (const drawable of drawables) {
    if (drawable.id.startsWith(HIT_AREA_PREFIX)) hitAreas.push(drawable);
    else artwork.push(drawable);
  }

  const groups = groupArtwork(artwork);
  if (hitAreas.length > 0) {
    groups.push({ key: 'hit-areas', label: 'Vùng chạm (không hiện hình)', drawables: hitAreas });
  }
  return groups;
}

function groupArtwork(artwork: DrawableInfo[]): DrawableGroup[] {
  const byPrefix = new Map<string, DrawableInfo[]>();
  let named = 0;
  for (const drawable of artwork) {
    const prefix = splitNamePrefix(drawable.id);
    if (prefix === null) continue;
    const bucket = byPrefix.get(prefix);
    if (bucket) bucket.push(drawable);
    else byPrefix.set(prefix, [drawable]);
    named += 1;
  }

  // One prefix covering everything means the exporter numbered the meshes
  // rather than the author naming them, which tells us nothing. Several
  // prefixes over most of the list means the names are real.
  const namesAreUseful = byPrefix.size > 1 && named >= artwork.length * 0.6;

  if (namesAreUseful) {
    return [...byPrefix.entries()]
      .map(([prefix, group]) => ({ key: `name:${prefix}`, label: prefix, drawables: group }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return groupByBand(artwork);
}

function groupByBand(artwork: DrawableInfo[]): DrawableGroup[] {
  if (artwork.length === 0) return [];

  // Top-down: neighbouring meshes end up adjacent in the list, which is what
  // makes a garment findable by scrolling once a group is open.
  const ordered = [...artwork].sort((a, b) => {
    const centreA = (a.bounds.minY + a.bounds.maxY) / 2;
    const centreB = (b.bounds.minY + b.bounds.maxY) / 2;
    return centreB - centreA;
  });

  const groups: DrawableGroup[] = [];
  let start = 0;
  for (const [bandIndex, band] of BODY_BANDS.entries()) {
    if (start >= ordered.length) break;

    const isLast = bandIndex === BODY_BANDS.length - 1;
    // The last band takes the remainder, so rounding can never drop a mesh.
    let end = isLast
      ? ordered.length
      : Math.min(ordered.length, start + Math.round(artwork.length * band.share));

    // Never split meshes that sit at the same height into different groups:
    // a mirrored pair (left sleeve, right sleeve) landing either side of a
    // boundary is the one grouping error a user would actually notice.
    if (!isLast) {
      const boundary = centreY(ordered[end - 1]);
      while (end < ordered.length && centreY(ordered[end]) === boundary) end += 1;
    }

    if (end > start) {
      groups.push({
        key: `band:${band.key}`,
        label: band.label,
        drawables: ordered.slice(start, end)
      });
    }
    start = end;
  }
  return groups;
}

function centreY(drawable: DrawableInfo): number {
  return (drawable.bounds.minY + drawable.bounds.maxY) / 2;
}
