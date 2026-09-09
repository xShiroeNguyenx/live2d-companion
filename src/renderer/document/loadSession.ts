import type { ModelAssets } from '../core/cubism/ModelAssets';
import { autosave } from './autosave';
import { commandStack } from './commands/CommandStack';
import { parseMotion, serializeMotion } from '../core/motion/MotionSerializer';
import { textureSession } from './textureSession';
import {
  cdi3Store,
  expressionsStore,
  model3Store,
  motionsStore,
  textureStore,
  physics3Store,
  pose3Store,
  type ExpressionSet,
  type MotionSet
} from './stores/documentStores';

/**
 * Populates every document store from a freshly read model.
 *
 * Loading is centralised so that opening a model resets the undo history and
 * the autosave queue together — a stale command from the previous model would
 * otherwise be applied to the new one's documents.
 */
export function loadDocumentsFromAssets(workspaceId: string, assets: ModelAssets): void {
  commandStack.reset();
  autosave.setWorkspace(workspaceId);

  model3Store
    .getState()
    .load(assets.modelSetting.data, assets.modelSetting.relativePath);

  if (assets.displayInfo) {
    cdi3Store.getState().load(assets.displayInfo.data, assets.displayInfo.relativePath);
  } else {
    cdi3Store.getState().unload();
  }

  if (assets.physics) {
    physics3Store.getState().load(assets.physics.data, assets.physics.relativePath);
  } else {
    physics3Store.getState().unload();
  }

  if (assets.pose) {
    pose3Store.getState().load(assets.pose.data, assets.pose.relativePath);
  } else {
    pose3Store.getState().unload();
  }

  const set: ExpressionSet = { byName: {}, files: {}, order: [] };
  for (const entry of assets.expressions) {
    set.byName[entry.name] = entry.document.data;
    set.files[entry.name] = entry.document.relativePath;
    set.order.push(entry.name);
  }
  // The expression set has no single file of its own; its splitter derives the
  // per-expression paths, so the store's own relativePath is just a marker.
  expressionsStore.getState().load(set, assets.modelSetting.relativePath);

  // Motions are parsed into the keyframe model up front: the timeline needs it,
  // and parsing on demand would put a stall in the middle of a click.
  const motionSet: MotionSet = { byPath: {}, groups: {}, groupOrder: [] };
  for (const entry of assets.motions) {
    if (!motionSet.byPath[entry.document.relativePath]) {
      motionSet.byPath[entry.document.relativePath] = parseMotion(entry.document.data);
    }
    const group = motionSet.groups[entry.group] ?? [];
    if (!group.includes(entry.document.relativePath)) {
      group.push(entry.document.relativePath);
    }
    motionSet.groups[entry.group] = group;
    if (!motionSet.groupOrder.includes(entry.group)) motionSet.groupOrder.push(entry.group);
  }
  motionsStore.getState().load(motionSet, assets.modelSetting.relativePath);

  // Texture layers are the app's own data, not part of the Live2D format, so
  // they live under the workspace's private prefix and are excluded from export.
  textureStore.getState().load({ layers: [] }, '.layers/textures.json');
  textureSession.setOriginals(assets.textureImages);

  commandStack.markSaved();
}

/**
 * Teaches autosave how the expression set maps onto files.
 *
 * Registered once at startup: each expression writes to the path it was loaded
 * from, and a newly created expression gets a path assigned when it is added.
 */
export function installMotionSplitter(): void {
  autosave.registerSplitter('motions', (data) => {
    const set = data as MotionSet;
    // Serializing here rather than storing the JSON means Meta counts are always
    // recomputed from the current keyframes on the way to disk.
    return Object.entries(set.byPath).map(([relativePath, document]) => ({
      relativePath,
      data: serializeMotion(document)
    }));
  });
}

export function installExpressionSplitter(): void {
  autosave.registerSplitter('expressions', (data) => {
    const set = data as ExpressionSet;
    return set.order
      .filter((name) => set.files[name] && set.byName[name])
      .map((name) => ({ relativePath: set.files[name], data: set.byName[name] }));
  });
}
