import { captureExpression, proposeExpressionName } from '../features/expressions/expressionOps';
import { autosave } from './autosave';
import { commandStack } from './commands/CommandStack';
import { suggestGroupIds } from '../features/config/configOps';
import { splitIssues, validateModel } from '../features/export/validate';
import { evaluateTrack } from '../core/motion/MotionEvaluator';
import { recordFrameNow } from './motionRecorder';
import { useMotionUiStore } from './stores/motionUiStore';
import { descendantParts } from '../core/cubism/ModelInfo';
import { drawablesForPart } from '../core/texture/RegionMasker';
import { createRecolorLayer, textureSession } from './textureSession';
import {
  cdi3Store,
  expressionsStore,
  model3Store,
  motionsStore,
  physics3Store,
  textureStore,
  pose3Store
} from './stores/documentStores';
import { useEditorUiStore } from './stores/editorUiStore';
import { useSessionStore } from './stores/sessionStore';
import { runtimeRef } from './runtimeRef';

/**
 * A scripted handle on the editor, used by `scripts/smoke-driver.js`.
 *
 * The smoke test drives the same code paths the UI does — capture, activate,
 * save, undo — rather than reimplementing them, so a regression in the real
 * flow cannot pass unnoticed. Kept in one module so it is obvious what the
 * test surface is, instead of globals appearing across the codebase.
 */
export interface EditorTestApi {
  setParameter(index: number, value: number): void;
  clearParameters(): void;
  parameterValue(index: number): number;
  authoredValue(index: number): number;
  captureExpression(): string | null;
  expressionCount(): number;
  expressionNames(): string[];
  expressionFile(name: string): string | null;
  activateExpression(name: string): void;
  undo(): void;
  undoState(): { canUndo: boolean; canRedo: boolean };
  captureMotionFrame(): { ok: boolean; reason?: string };
  motionPaths(): string[];
  openMotion(path: string | null): void;
  motionInfo(path: string): { duration: number; fps: number; tracks: number; keyframes: number } | null;
  seekMotion(time: number): void;
  playMotion(playing: boolean): void;
  recordMotion(recording: boolean): void;
  motionValueAt(path: string, trackId: string, time: number): number | null;
  recolorLargestPart(hue: number): {
    ok: boolean;
    error?: string;
    part?: string;
    drawables?: number;
    maskPixels?: number;
    textureIndex?: number;
    colouredPixels?: number;
    uploaded?: boolean;
  };
  setLayerVisible(visible: boolean): void;
  setHiddenParts(partIndices: number[]): void;
  setHiddenDrawables(drawableIndices: number[]): void;
  hiddenReport(): { ok: boolean; zeroedDrawables?: number; totalDrawables?: number };
  meshReport(partIndex: number): unknown;
  partMeshes(partName: string): { partIndex: number; drawables: number[] } | null;
  setIsolatedPart(partIndex: number | null): void;
  addHitArea(drawableId: string, name: string): void;
  applyGroupSuggestions(): void;
  validate(): { errors: number; warnings: number; messages: string[] };
  exportTo(destinationDir: string, folderName: string): Promise<unknown>;
  flushSave(): Promise<void>;
  readFile(relativePath: string | null): Promise<string | null>;
  motionGroups(): Record<string, number>;
}

/**
 * Counts pixels under a mask that carry actual colour.
 *
 * Used to choose a region where a hue shift is observable: a mask over black or
 * white artwork changes nothing however the sliders move, so measuring there
 * would report a failure that is not one.
 */
function countColouredPixels(
  textureIndex: number,
  mask: { width: number; height: number; data: Uint8Array }
): number {
  const original = textureSession.getOriginal(textureIndex);
  if (!original) return 0;

  const canvas = new OffscreenCanvas(original.width, original.height);
  const context = canvas.getContext('2d');
  if (!context) return 0;
  context.drawImage(original, 0, 0);
  const pixels = context.getImageData(0, 0, original.width, original.height).data;

  let count = 0;
  for (let index = 0; index < mask.data.length; index += 1) {
    if (mask.data[index] === 0) continue;
    const offset = index * 4;
    if (pixels[offset + 3] < 200) continue;
    const r = pixels[offset];
    const g = pixels[offset + 1];
    const b = pixels[offset + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) >= 40) count += 1;
  }
  return count;
}

const api: EditorTestApi = {
  setParameter(index, value) {
    runtimeRef.current?.setOverride(index, value);
  },

  clearParameters() {
    runtimeRef.current?.clearAllOverrides();
  },

  parameterValue(index) {
    const model = runtimeRef.current?.model;
    return model ? model.getParameterValueByIndex(index) : Number.NaN;
  },

  authoredValue(index) {
    const authored = runtimeRef.current?.getAuthoredValues();
    return authored ? (authored[index] ?? Number.NaN) : Number.NaN;
  },

  captureExpression() {
    const session = useSessionStore.getState();
    const runtime = runtimeRef.current;
    if (!session.info || !runtime) return null;

    // The authored snapshot excludes physics, matching what the panel captures.
    const expression = captureExpression({
      values: runtime.getAuthoredValues(),
      info: session.info
    });
    if (expression.Parameters.length === 0) return null;

    const set = expressionsStore.getState().data;
    const { name, fileName } = proposeExpressionName(set, 'expression');
    const filePath = `${session.baseDir}${fileName}`;

    expressionsStore.getState().edit(`Tạo biểu cảm "${name}"`, (draft) => {
      draft.byName[name] = expression;
      draft.files[name] = filePath;
      draft.order.push(name);
    });
    model3Store.getState().edit(`Thêm biểu cảm "${name}" vào model3`, (draft) => {
      const expressions = draft.FileReferences.Expressions ?? [];
      expressions.push({ Name: name, File: fileName });
      draft.FileReferences.Expressions = expressions;
    });
    return name;
  },

  expressionCount() {
    return expressionsStore.getState().data.order.length;
  },

  expressionNames() {
    return [...expressionsStore.getState().data.order];
  },

  expressionFile(name) {
    return expressionsStore.getState().data.files[name] ?? null;
  },

  activateExpression(name) {
    useEditorUiStore.getState().setExpressionWeight(name, 1);
  },

  undo() {
    commandStack.undo();
  },

  undoState() {
    const snapshot = commandStack.snapshot();
    return { canUndo: snapshot.canUndo, canRedo: snapshot.canRedo };
  },

  captureMotionFrame() {
    return recordFrameNow();
  },

  motionPaths() {
    return Object.keys(motionsStore.getState().data.byPath);
  },

  openMotion(path) {
    useMotionUiStore.getState().openMotion(path);
  },

  motionInfo(path) {
    const document = motionsStore.getState().data.byPath[path];
    if (!document) return null;
    return {
      duration: document.duration,
      fps: document.fps,
      tracks: document.tracks.length,
      keyframes: document.tracks.reduce((total, track) => total + track.keyframes.length, 0)
    };
  },

  seekMotion(time) {
    useMotionUiStore.getState().setTime(time);
  },

  playMotion(playing) {
    useMotionUiStore.getState().setPlaying(playing);
  },

  recordMotion(recording) {
    useMotionUiStore.getState().setRecording(recording);
  },

  motionValueAt(path, trackId, time) {
    const document = motionsStore.getState().data.byPath[path];
    const track = document?.tracks.find((entry) => entry.id === trackId);
    if (!document || !track) return null;
    return evaluateTrack(track, time, document.areBeziersRestricted);
  },

  recolorLargestPart(hue) {
    const info = useSessionStore.getState().info;
    if (!info) return { ok: false, error: 'no model' };

    // Pick the part covering the most *coloured* artwork. Counting drawables
    // instead would happily choose a technical grouping part whose art is a
    // black mask, where a hue shift is a no-op and the test proves nothing.
    let bestPart = -1;
    let bestTexture = -1;
    let bestDrawables: number[] = [];
    let bestScore = 0;
    let bestMask = null;

    for (const part of info.parts) {
      const byTexture = drawablesForPart(info, descendantParts(info, part.index));
      for (const [textureIndex, drawables] of byTexture) {
        if (drawables.length === 0) continue;
        const mask = textureSession.buildMask(textureIndex, drawables);
        if (!mask) continue;

        const score = countColouredPixels(textureIndex, mask);
        if (score > bestScore) {
          bestScore = score;
          bestPart = part.index;
          bestTexture = textureIndex;
          bestDrawables = drawables;
          bestMask = mask;
        }
      }
    }

    if (bestPart < 0 || !bestMask) {
      return { ok: false, error: 'no part covers coloured artwork' };
    }
    const textureIndex = bestTexture;
    const drawables = bestDrawables;
    const mask = bestMask;

    const layer = createRecolorLayer(textureIndex, info.parts[bestPart].name, mask);
    layer.hue = hue;
    textureStore.getState().edit('Đổi màu (test)', (draft) => {
      draft.layers.push(layer);
    });

    let maskPixels = 0;
    for (const value of mask.data) if (value > 0) maskPixels += 1;

    // The panel does this from an effect when its sliders change; a headless
    // test has no mounted panel, so it has to composite and upload itself.
    const composite = textureSession.composite(
      textureIndex,
      textureStore.getState().data.layers
    );
    if (composite) void textureSession.uploadToModel(textureIndex, composite);

    return {
      ok: true,
      part: info.parts[bestPart].name,
      drawables: drawables.length,
      textureIndex,
      maskPixels,
      colouredPixels: bestScore,
      uploaded: composite !== null
    };
  },


  setLayerVisible(visible) {
    textureStore.getState().edit('Bật/tắt lớp (test)', (draft) => {
      for (const layer of draft.layers) layer.visible = visible;
    });

    const layers = textureStore.getState().data.layers;
    const touched = new Set(layers.map((layer) => layer.textureIndex));
    for (const textureIndex of touched) {
      const composite = textureSession.composite(textureIndex, layers);
      if (composite) void textureSession.uploadToModel(textureIndex, composite);
    }
  },

  setHiddenDrawables(drawableIndices) {
    runtimeRef.current?.setHiddenDrawables(drawableIndices);
  },

  meshReport(partIndex) {
    const info = useSessionStore.getState().info;
    const runtime = runtimeRef.current;
    if (!info || !runtime) return { ok: false };

    const model = runtime.model;
    const own = info.drawables.filter((d) => d.parentPartIndex === partIndex);
    return {
      ok: true,
      meshes: own.map((d) => ({
        index: d.index,
        id: d.id,
        visible: model.getDrawableDynamicFlagIsVisible(d.index),
        opacity: Number(model.getDrawableOpacity(d.index).toFixed(3)),
        vertices: d.vertexCount
      }))
    };
  },

  hiddenReport() {
    const info = useSessionStore.getState().info;
    const runtime = runtimeRef.current;
    if (!info || !runtime) return { ok: false };
    const opacities = runtime.model.getModel().drawables.opacities;
    let zeroed = 0;
    for (const value of opacities) if (value === 0) zeroed += 1;
    return { ok: true, zeroedDrawables: zeroed, totalDrawables: opacities.length };
  },

  partMeshes(partName) {
    const info = useSessionStore.getState().info;
    if (!info) return null;
    const part = info.parts.find((entry) => entry.name === partName || entry.id === partName);
    if (!part) return null;
    return {
      partIndex: part.index,
      drawables: info.drawables
        .filter((drawable) => drawable.parentPartIndex === part.index)
        .map((drawable) => drawable.index)
    };
  },

  setHiddenParts(partIndices) {
    runtimeRef.current?.setHiddenParts(partIndices);
  },

  setIsolatedPart(partIndex) {
    runtimeRef.current?.setIsolatedPart(partIndex);
  },

  addHitArea(drawableId, name) {
    model3Store.getState().edit(`Thêm vùng chạm "${name}"`, (draft) => {
      const areas = draft.HitAreas ?? [];
      areas.push({ Id: drawableId, Name: name });
      draft.HitAreas = areas;
    });
  },

  applyGroupSuggestions() {
    const info = useSessionStore.getState().info;
    if (!info) return;
    const suggestions = suggestGroupIds(info);
    model3Store.getState().edit('Cập nhật nhóm EyeBlink và LipSync', (draft) => {
      const groups = (draft.Groups ?? []).filter(
        (group) => group.Name !== 'EyeBlink' && group.Name !== 'LipSync'
      );
      if (suggestions.eyeBlink.length > 0) {
        groups.push({ Target: 'Parameter', Name: 'EyeBlink', Ids: suggestions.eyeBlink });
      }
      if (suggestions.lipSync.length > 0) {
        groups.push({ Target: 'Parameter', Name: 'LipSync', Ids: suggestions.lipSync });
      }
      draft.Groups = groups;
    });
  },

  validate() {
    const session = useSessionStore.getState();
    if (!session.info) return { errors: 0, warnings: 0, messages: ['no model'] };

    const issues = validateModel({
      info: session.info,
      model3: model3Store.getState().data,
      pose: pose3Store.getState().relativePath ? pose3Store.getState().data : null,
      physics: physics3Store.getState().relativePath
        ? physics3Store.getState().data
        : null,
      cdi3: cdi3Store.getState().relativePath ? cdi3Store.getState().data : null,
      expressions: expressionsStore.getState().data,
      textureSizes: session.textureSizes
    });
    const split = splitIssues(issues);
    return {
      errors: split.errors.length,
      warnings: split.warnings.length,
      messages: issues.map((issue) => `${issue.severity}: ${issue.source} — ${issue.message}`)
    };
  },

  async exportTo(destinationDir, folderName) {
    const workspace = useSessionStore.getState().workspace;
    if (!workspace) return { ok: false, error: 'no workspace' };
    await autosave.flush();
    return window.api.exportModel({
      workspaceId: workspace.id,
      destinationDir,
      folderName,
      overwrite: true
    });
  },

  async flushSave() {
    await autosave.flush();
  },

  async readFile(relativePath) {
    const workspace = useSessionStore.getState().workspace;
    if (!workspace || !relativePath) return null;
    const file = await window.api.readWorkspaceFile(workspace.id, relativePath);
    return new TextDecoder().decode(file.data);
  },

  motionGroups() {
    const groups = motionsStore.getState().data.groups;
    return Object.fromEntries(Object.entries(groups).map(([name, paths]) => [name, paths.length]));
  }
};

/** Exposes the test handle on `window`. Called once from the app entry. */
export function installTestApi(): void {
  (window as unknown as { __editorTestApi?: EditorTestApi }).__editorTestApi = api;
}

/**
 * Also exposes the UI store, so a screenshot script can switch tabs and set a
 * selection the same way a click would.
 */
export function installUiStoreHandle(store: unknown): void {
  (window as unknown as { __editorUiStore?: unknown }).__editorUiStore = store;
}
