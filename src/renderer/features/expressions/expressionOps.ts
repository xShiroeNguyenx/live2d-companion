import type { Exp3Json } from '@shared/types/live2d-files';
import type { ModelInfo } from '../../core/cubism/ModelInfo';
import type { ExpressionSet } from '../../document/stores/documentStores';

/** How much a parameter must move from its default to be worth capturing. */
const CAPTURE_EPSILON = 1e-4;

export interface CaptureSource {
  /** Current value per parameter index, as the runtime has it. */
  values: Float32Array;
  info: ModelInfo;
}

/**
 * Builds an expression from the pose currently on screen.
 *
 * Only parameters that actually moved are recorded, and they are stored as
 * offsets from the model's default with `Blend: "Add"` — the same convention
 * Cubism Editor uses. That matters for compatibility: an additive expression
 * layers correctly over an idle motion, whereas an Overwrite expression would
 * fight it and freeze the model.
 */
export function captureExpression(source: CaptureSource): Exp3Json {
  const parameters: Exp3Json['Parameters'] = [];

  for (const parameter of source.info.parameters) {
    const current = source.values[parameter.index];
    if (current === undefined) continue;
    const delta = current - parameter.default;
    if (Math.abs(delta) < CAPTURE_EPSILON) continue;
    parameters.push({
      Id: parameter.id,
      Value: roundValue(delta),
      Blend: 'Add'
    });
  }

  return {
    Type: 'Live2D Expression',
    FadeInTime: 0.5,
    FadeOutTime: 0.5,
    Parameters: parameters
  };
}

/** Trims float noise so the written JSON stays readable. */
function roundValue(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/**
 * Picks a filename and expression name that do not collide with existing ones.
 *
 * Both matter: the name is model3.json's key (and what VTube Studio shows in its
 * hotkey list), and the file has to be unique on disk.
 */
export function proposeExpressionName(
  set: ExpressionSet,
  baseName = 'expression'
): { name: string; fileName: string } {
  const taken = new Set(set.order);
  const takenFiles = new Set(Object.values(set.files).map((path) => path.toLowerCase()));

  for (let index = 1; index < 1000; index += 1) {
    const name = index === 1 ? baseName : `${baseName}_${index}`;
    const fileName = `${name}.exp3.json`;
    if (!taken.has(name) && !takenFiles.has(fileName.toLowerCase())) {
      return { name, fileName };
    }
  }
  // Practically unreachable; a timestamp guarantees termination.
  const fallback = `${baseName}_${Date.now()}`;
  return { name: fallback, fileName: `${fallback}.exp3.json` };
}

/** Parameters an expression touches that another one also touches. */
export function findExpressionConflicts(
  set: ExpressionSet,
  activeNames: string[]
): Map<string, string[]> {
  const owners = new Map<string, string[]>();

  for (const name of activeNames) {
    const expression = set.byName[name];
    if (!expression) continue;
    for (const parameter of expression.Parameters) {
      const list = owners.get(parameter.Id);
      if (list) list.push(name);
      else owners.set(parameter.Id, [name]);
    }
  }

  // Only genuine overlaps are conflicts.
  for (const [id, names] of [...owners]) {
    if (names.length < 2) owners.delete(id);
  }
  return owners;
}
