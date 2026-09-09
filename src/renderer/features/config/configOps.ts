import type { ModelInfo, ParameterInfo } from '../../core/cubism/ModelInfo';

/**
 * Guesses which parameters belong in the EyeBlink and LipSync groups.
 *
 * Worth guessing because these two groups are the difference between a model
 * that blinks and talks in a companion app and one that stares blankly, and
 * because almost every model follows the Cubism naming convention closely
 * enough for a heuristic to be right.
 *
 * Matching is on the parameter id, not the display name: ids follow the
 * convention, while display names are often localised (Hiyori's are Japanese).
 */
export function suggestGroupIds(info: ModelInfo): {
  eyeBlink: string[];
  lipSync: string[];
} {
  return {
    eyeBlink: suggestEyeBlink(info.parameters),
    lipSync: suggestLipSync(info.parameters)
  };
}

function suggestEyeBlink(parameters: ParameterInfo[]): string[] {
  // The standard ids, in the order the SDK samples list them.
  const exact = ['ParamEyeLOpen', 'ParamEyeROpen'];
  const found = exact.filter((id) => parameters.some((parameter) => parameter.id === id));
  if (found.length > 0) return found;

  // Fall back to anything that looks like an eye-open parameter, while
  // excluding the smile and form parameters that also match "eye".
  return parameters
    .filter((parameter) => {
      const id = parameter.id.toLowerCase();
      return id.includes('eye') && id.includes('open') && !id.includes('ball');
    })
    .map((parameter) => parameter.id);
}

function suggestLipSync(parameters: ParameterInfo[]): string[] {
  const exact = 'ParamMouthOpenY';
  if (parameters.some((parameter) => parameter.id === exact)) return [exact];

  // Lip-sync drives mouth opening only; mouth *form* changes the shape of a
  // smile and would look wrong driven by audio volume.
  return parameters
    .filter((parameter) => {
      const id = parameter.id.toLowerCase();
      return id.includes('mouth') && id.includes('open') && !id.includes('form');
    })
    .map((parameter) => parameter.id);
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  /** Which part of the model the issue belongs to, for grouping in the UI. */
  area: string;
  message: string;
}
