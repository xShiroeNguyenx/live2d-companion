import type {
  Cdi3Json,
  Exp3Json,
  Model3Json,
  Motion3Json,
  Physics3Json,
  Pose3Json
} from '@shared/types/live2d-files';

/**
 * Everything read out of a workspace before the model can be built.
 *
 * Loading is split from `loadModel` so the file reads (async IPC) stay separate
 * from the GL work (synchronous, needs a live context).
 *
 * Every editable document carries the path it came from, because autosave writes
 * back to exactly that path and the paths in model3.json are relative to the
 * model3.json itself rather than to the workspace root.
 */
export interface LoadedDocument<T> {
  /** Path relative to the workspace's `working/` directory. */
  relativePath: string;
  data: T;
  /** Original text, used to hand physics and pose straight to the runtime. */
  text: string;
}

export interface ModelAssets {
  /** Directory of the model3.json inside `working/`, with a trailing slash. */
  baseDir: string;
  modelSetting: LoadedDocument<Model3Json>;
  mocBuffer: ArrayBuffer;
  textureImages: ImageBitmap[];
  displayInfo: LoadedDocument<Cdi3Json> | null;
  physics: LoadedDocument<Physics3Json> | null;
  pose: LoadedDocument<Pose3Json> | null;
  /** One entry per expression declared in model3.json, in declaration order. */
  expressions: Array<{ name: string; document: LoadedDocument<Exp3Json> }>;
  /** Motions keyed by their model3.json path, plus the group they belong to. */
  motions: Array<{
    /** Path as written in model3.json, relative to the model3.json directory. */
    reference: string;
    group: string;
    document: LoadedDocument<Motion3Json>;
  }>;
  /** Referenced files that were absent, so the UI can warn without failing. */
  missing: string[];
}

function directoryOf(relativePath: string): string {
  const index = relativePath.lastIndexOf('/');
  return index === -1 ? '' : relativePath.slice(0, index + 1);
}

async function readDocument<T>(
  workspaceId: string,
  relativePath: string
): Promise<LoadedDocument<T> | null> {
  try {
    const file = await window.api.readWorkspaceFile(workspaceId, relativePath);
    const text = new TextDecoder().decode(file.data);
    return { relativePath, text, data: JSON.parse(text) as T };
  } catch {
    return null;
  }
}

/**
 * Reads a model's files out of a workspace.
 *
 * A missing optional file is recorded rather than thrown: a model with no
 * physics or no expressions is perfectly valid, and the point of the app is to
 * let the user add them.
 */
export async function loadModelAssets(
  workspaceId: string,
  modelSettingFile: string
): Promise<ModelAssets> {
  const modelSetting = await readDocument<Model3Json>(workspaceId, modelSettingFile);
  if (!modelSetting) {
    throw new Error(`Không đọc được ${modelSettingFile}`);
  }

  const baseDir = directoryOf(modelSettingFile);
  const refs = modelSetting.data.FileReferences;
  const missing: string[] = [];

  const mocFile = await window.api.readWorkspaceFile(workspaceId, baseDir + refs.Moc);

  const textureImages = await Promise.all(
    refs.Textures.map(async (texturePath) => {
      const file = await window.api.readWorkspaceFile(workspaceId, baseDir + texturePath);
      return createImageBitmap(new Blob([file.data], { type: 'image/png' }));
    })
  );

  const displayInfo = refs.DisplayInfo
    ? await readDocument<Cdi3Json>(workspaceId, baseDir + refs.DisplayInfo)
    : null;
  if (refs.DisplayInfo && !displayInfo) missing.push(refs.DisplayInfo);

  const physics = refs.Physics
    ? await readDocument<Physics3Json>(workspaceId, baseDir + refs.Physics)
    : null;
  if (refs.Physics && !physics) missing.push(refs.Physics);

  const pose = refs.Pose
    ? await readDocument<Pose3Json>(workspaceId, baseDir + refs.Pose)
    : null;
  if (refs.Pose && !pose) missing.push(refs.Pose);

  const expressions: ModelAssets['expressions'] = [];
  for (const entry of refs.Expressions ?? []) {
    const document = await readDocument<Exp3Json>(workspaceId, baseDir + entry.File);
    if (document) expressions.push({ name: entry.Name, document });
    else missing.push(entry.File);
  }

  // A motion file can be listed in several groups; read it once and record each
  // membership, so editing it updates every group that plays it.
  const motions: ModelAssets['motions'] = [];
  const seenMotionPaths = new Map<string, LoadedDocument<Motion3Json>>();
  for (const [group, entries] of Object.entries(refs.Motions ?? {})) {
    for (const entry of entries) {
      let document = seenMotionPaths.get(entry.File);
      if (!document) {
        const loaded = await readDocument<Motion3Json>(workspaceId, baseDir + entry.File);
        if (!loaded) {
          missing.push(entry.File);
          continue;
        }
        document = loaded;
        seenMotionPaths.set(entry.File, loaded);
      }
      motions.push({ reference: entry.File, group, document });
    }
  }

  return {
    baseDir,
    modelSetting,
    mocBuffer: mocFile.data,
    textureImages,
    displayInfo,
    physics,
    pose,
    expressions,
    motions,
    missing
  };
}
