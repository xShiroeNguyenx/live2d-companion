import type {
  Cdi3Json,
  Exp3Json,
  Model3Json,
  Physics3Json,
  Pose3Json
} from '@shared/types/live2d-files';
import type { MotionDocument } from '../../core/motion/MotionDocument';
import type { TextureLayer } from '../../core/texture/TextureCompositor';
import { createDocumentStore } from '../createDocumentStore';

/**
 * One store per editable document.
 *
 * Scopes are stable strings because the undo stack keys patches by them; renaming
 * a scope would orphan history recorded under the old name.
 */

const emptyModel3: Model3Json = {
  Version: 3,
  FileReferences: { Moc: '', Textures: [] }
};

export const model3Store = createDocumentStore<Model3Json>('model3', emptyModel3);

const emptyPose3: Pose3Json = { Type: 'Live2D Pose', FadeInTime: 0.5, Groups: [] };

export const pose3Store = createDocumentStore<Pose3Json>('pose3', emptyPose3);

const emptyCdi3: Cdi3Json = {
  Version: 3,
  Parameters: [],
  ParameterGroups: [],
  Parts: []
};

export const cdi3Store = createDocumentStore<Cdi3Json>('cdi3', emptyCdi3);

const emptyPhysics3: Physics3Json = {
  Version: 3,
  Meta: {
    PhysicsSettingCount: 0,
    TotalInputCount: 0,
    TotalOutputCount: 0,
    VertexCount: 0,
    EffectiveForces: { Gravity: { X: 0, Y: -1 }, Wind: { X: 0, Y: 0 } },
    PhysicsDictionary: []
  },
  PhysicsSettings: []
};

export const physics3Store = createDocumentStore<Physics3Json>('physics3', emptyPhysics3);

/**
 * Expressions are many files rather than one, so this store holds the whole set
 * keyed by the name model3.json gives each: editing one expression and
 * reordering the list are then a single undoable document change.
 */
export interface ExpressionSet {
  /** Keyed by the expression's `Name` in model3.json's FileReferences. */
  byName: Record<string, Exp3Json>;
  /** File path per expression name, relative to the model3.json directory. */
  files: Record<string, string>;
  /** Display order, mirroring model3.json. */
  order: string[];
}

const emptyExpressions: ExpressionSet = { byName: {}, files: {}, order: [] };

export const expressionsStore = createDocumentStore<ExpressionSet>(
  'expressions',
  emptyExpressions
);

export function unloadAllDocuments(): void {
  model3Store.getState().unload();
  pose3Store.getState().unload();
  cdi3Store.getState().unload();
  physics3Store.getState().unload();
  expressionsStore.getState().unload();
  motionsStore.getState().unload();
  textureStore.getState().unload();
}

/**
 * Motions, like expressions, are many files edited as one document.
 *
 * Keyed by the path model3.json references them at, because a motion can appear
 * in more than one group (an idle motion reused as a tap response) and the path
 * is what identifies the file.
 */
export interface MotionSet {
  /** Editable motion per file path, relative to the workspace working dir. */
  byPath: Record<string, MotionDocument>;
  /** Group membership as model3.json declares it. */
  groups: Record<string, string[]>;
  /** Display order of the groups. */
  groupOrder: string[];
}

const emptyMotions: MotionSet = { byPath: {}, groups: {}, groupOrder: [] };

export const motionsStore = createDocumentStore<MotionSet>('motions', emptyMotions);

/**
 * Texture edits, stored as layer definitions rather than pixels.
 *
 * This is what makes recolouring non-destructive and undoable: the jacket's hue
 * is a number in a JSON file, so it can be changed again next week, and undo is
 * a patch rather than a multi-megabyte bitmap snapshot. The pixels themselves
 * live in textureSession, outside the store.
 *
 * Written to the workspace as an app-private file, never into the exported
 * model — the export carries the flattened PNGs, which is all any runtime
 * understands.
 */
export interface TextureEdits {
  layers: TextureLayer[];
}

const emptyTextureEdits: TextureEdits = { layers: [] };

export const textureStore = createDocumentStore<TextureEdits>(
  'textures',
  emptyTextureEdits
);
