import type { Physics3Json, PhysicsSetting } from '@shared/types/live2d-files';

/**
 * The two things a non-technical user actually wants to change about a physics
 * chain: how far it swings, and how quickly it settles.
 *
 * physics3.json has no such fields — it has per-vertex mobility, delay and
 * acceleration, plus per-output scale. Exposing those raw is how the Cubism
 * Editor does it and is why most people never touch physics at all. These two
 * macros map onto the underlying values so the panel can offer "swing more" and
 * "stiffer" and still write a valid file.
 */
export interface ChainFeel {
  /** 0 = barely moves, 1 = default authored amount, 2 = twice as far. */
  swing: number;
  /** 0 = floppy, 1 = as authored, 2 = stiff and quick to settle. */
  stiffness: number;
}

export const NEUTRAL_FEEL: ChainFeel = { swing: 1, stiffness: 1 };

/**
 * Reads the current macro values back out of a chain.
 *
 * The macros are stored nowhere: they are derived from the raw fields relative
 * to a baseline captured when the model loaded. Deriving rather than storing
 * keeps physics3.json exactly as the format specifies, with no editor-private
 * keys that other runtimes would have to ignore.
 */
export function readChainFeel(
  setting: PhysicsSetting,
  baseline: PhysicsSetting
): ChainFeel {
  const baseScale = averageOutputScale(baseline);
  const currentScale = averageOutputScale(setting);
  const baseMobility = averageMobility(baseline);
  const currentMobility = averageMobility(setting);

  return {
    swing: baseScale > 0 ? currentScale / baseScale : 1,
    // Mobility runs the other way round from "stiffness": a high mobility means
    // the chain follows loosely, which reads as floppy.
    stiffness: currentMobility > 0 ? baseMobility / currentMobility : 1
  };
}

/** Writes macro values back onto the raw fields, relative to the baseline. */
export function applyChainFeel(
  setting: PhysicsSetting,
  baseline: PhysicsSetting,
  feel: ChainFeel
): void {
  const swing = clamp(feel.swing, 0, 3);
  const stiffness = clamp(feel.stiffness, 0.2, 3);

  for (const [index, output] of setting.Output.entries()) {
    const base = baseline.Output[index];
    if (base) output.Scale = round(base.Scale * swing);
  }

  for (const [index, vertex] of setting.Vertices.entries()) {
    const base = baseline.Vertices[index];
    if (!base) continue;
    // Mobility is a 0..1 blend factor in the simulation, so it has to stay in
    // range however far the user pushes the macro.
    vertex.Mobility = round(clamp(base.Mobility / stiffness, 0.01, 1));
    // Delay behaves the same way: more stiffness means less lag.
    vertex.Delay = round(clamp(base.Delay / stiffness, 0.01, 5));
  }
}

/** Chain display name from the dictionary, falling back to its id. */
export function chainName(physics: Physics3Json, settingId: string): string {
  return (
    physics.Meta.PhysicsDictionary.find((entry) => entry.Id === settingId)?.Name ??
    settingId
  );
}

/**
 * Recomputes the Meta totals from the settings.
 *
 * Same reasoning as motion3's counts: several loaders size buffers from these
 * up front, so an edit that changes the number of inputs or vertices has to
 * update them or the file breaks elsewhere.
 */
export function recomputePhysicsMeta(physics: Physics3Json): void {
  let inputs = 0;
  let outputs = 0;
  let vertices = 0;

  for (const setting of physics.PhysicsSettings) {
    inputs += setting.Input.length;
    outputs += setting.Output.length;
    vertices += setting.Vertices.length;
  }

  physics.Meta.PhysicsSettingCount = physics.PhysicsSettings.length;
  physics.Meta.TotalInputCount = inputs;
  physics.Meta.TotalOutputCount = outputs;
  physics.Meta.VertexCount = vertices;
}

function averageOutputScale(setting: PhysicsSetting): number {
  if (setting.Output.length === 0) return 0;
  return (
    setting.Output.reduce((total, output) => total + Math.abs(output.Scale), 0) /
    setting.Output.length
  );
}

function averageMobility(setting: PhysicsSetting): number {
  if (setting.Vertices.length === 0) return 0;
  return (
    setting.Vertices.reduce((total, vertex) => total + vertex.Mobility, 0) /
    setting.Vertices.length
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Keeps written numbers readable rather than full float noise. */
function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}
