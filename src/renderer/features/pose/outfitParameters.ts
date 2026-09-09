import type { Exp3Json } from '@shared/types/live2d-files';
import type { ModelInfo } from '../../core/cubism/ModelInfo';

/**
 * Detection of the parameters a model author uses to switch outfits.
 *
 * Many models — most of them exported before parts were widely used — carry no
 * pose3.json and no part assignments, yet still change clothes perfectly well:
 * the author wired a 0..1 parameter to each outfit and keys the garment meshes
 * off it. That machinery is already in the moc and needs no editing, but
 * nothing in the UI surfaces it, so the user cannot find it.
 *
 * Finding it by name does not work. Ids are arbitrary (`ParamC1`) and the
 * display names are in the author's own language — 睡衣, パジャマ, pyjamas — so a
 * keyword list would only cover the models we happened to test. What the
 * parameters have in common is *behaviour*: moving one from 0 to 1 makes a
 * whole garment's worth of meshes appear and another's disappear. That is what
 * this module measures.
 */

/** One parameter that switches a visible chunk of the model on or off. */
export interface OutfitParameter {
  index: number;
  id: string;
  name: string;
  /** Meshes that appear when the parameter goes to 1. */
  shows: number[];
  /** Meshes that disappear when it goes to 1. */
  hides: number[];
}

/**
 * A mesh counts as visible above this opacity.
 *
 * Not zero: a garment that is switched "off" is often left at a residual
 * opacity by the deformer chain rather than exactly 0, and treating those as
 * visible would report every parameter as changing nothing.
 */
const VISIBLE_OPACITY = 0.01;

/**
 * How much of the model a parameter must switch to count as an outfit control.
 *
 * A fraction rather than a count, because "20 meshes" means something very
 * different on a 130-mesh model than on a 390-mesh one. The value sits above
 * facial expressions — blinking and mouth shapes move a handful of meshes,
 * around 3% of a detailed model — and below a garment, which runs to 5-15%.
 */
const MIN_SWITCHED_FRACTION = 0.04;

/**
 * The floor under that fraction.
 *
 * On a small model the fraction alone lets facial expressions through: a blink
 * switching four meshes clears 4% of a hundred-mesh model. A garment is a
 * collection of pieces — bodice, sleeves, trim — so requiring several meshes
 * outright separates it from anything on a face, at every model size.
 */
const MIN_SWITCHED_MESHES = 8;

/**
 * The reading of the model that detection needs.
 *
 * Declared as an interface rather than taking the Core model directly so the
 * logic can be tested against a hand-written model: the alternative is loading
 * a real moc3 in a test, which needs a GPU context.
 */
export interface OpacityProbe {
  /**
   * Opacity per drawable with one parameter set to `value` and everything else
   * at its default.
   */
  opacitiesAt(parameterIndex: number, value: number): Float32Array;
}

/**
 * Parameters that switch outfits, strongest first.
 *
 * Returns an empty array for models that do not work this way, which is the
 * common case — the caller is expected to treat "none found" as normal rather
 * than as an error.
 */
export function detectOutfitParameters(
  info: ModelInfo,
  probe: OpacityProbe
): OutfitParameter[] {
  const threshold = Math.max(
    MIN_SWITCHED_MESHES,
    Math.ceil(info.drawables.length * MIN_SWITCHED_FRACTION)
  );
  const found: OutfitParameter[] = [];

  for (const parameter of info.parameters) {
    // Outfit switches are on/off by construction. Restricting to 0..1 also
    // keeps the probe cheap: an angle parameter would need sampling across its
    // range to say anything, and never switches whole garments anyway.
    if (parameter.minimum !== 0 || parameter.maximum !== 1) continue;
    // A blend shape adds a deformation on top of the base mesh; it moves
    // artwork rather than swapping it.
    if (parameter.isBlendShape) continue;

    const off = probe.opacitiesAt(parameter.index, 0);
    const on = probe.opacitiesAt(parameter.index, 1);

    const shows: number[] = [];
    const hides: number[] = [];
    const count = Math.min(off.length, on.length);
    for (let index = 0; index < count; index += 1) {
      const wasVisible = off[index] > VISIBLE_OPACITY;
      const isVisible = on[index] > VISIBLE_OPACITY;
      if (wasVisible === isVisible) continue;
      if (isVisible) shows.push(index);
      else hides.push(index);
    }

    if (shows.length + hides.length < threshold) continue;
    found.push({
      index: parameter.index,
      id: parameter.id,
      name: parameter.name,
      shows,
      hides
    });
  }

  // Most artwork first: on a model with several switches, the one that changes
  // the whole outfit is more useful at the top than a sleeve variant.
  return found.sort((a, b) => b.shows.length + b.hides.length - (a.shows.length + a.hides.length));
}

/**
 * Why there is no automatic "these outfits are alternatives" detection.
 *
 * It was tried and removed. The plausible signals all fail on real models:
 *
 * - **Hiding each other's meshes.** Only works when two outfits are on at once
 *   by default. Authors ship every alternative switched off except one, so a
 *   probe sees each switch reveal its own artwork and hide nothing.
 * - **Sharing meshes.** Assumes alternatives reuse the same geometry. They do
 *   not: each outfit is drawn on its own meshes, so the sets are disjoint.
 * - **Covering the same area.** Every full-body garment covers the whole body,
 *   and so does an arm-position switch — measured overlap was 100% for pairs
 *   that are alternatives and for pairs that are not.
 *
 * What remains is the user, who can see at a glance that 睡衣 and 毛衣 are two
 * outfits while 右臂切换 is an arm pose. The panel therefore lists switches flat
 * and lets the user tick the ones that belong together.
 */

/**
 * An outfit expressed as an exp3.json.
 *
 * `Overwrite` rather than the additive blend expressions normally use. An outfit
 * switch states which garment is on, and it has to hold against whatever else
 * is running: with `Add`, a motion that also touches the switch would sum with
 * it and leave two outfits half-drawn.
 *
 * Every switch the user marked as part of the outfit is written, the ones they
 * did not choose written as 0. That is what makes the expression a complete
 * statement — selecting it turns the chosen garments on *and* the alternatives
 * off, so a runtime switching between two of these never shows both at once.
 */
export function outfitExpression(
  all: OutfitParameter[],
  chosenIndices: Iterable<number>
): Exp3Json {
  const chosen = new Set(chosenIndices);
  return {
    Type: 'Live2D Expression',
    FadeInTime: 0.5,
    FadeOutTime: 0.5,
    Parameters: all.map((parameter) => ({
      Id: parameter.id,
      Value: chosen.has(parameter.index) ? 1 : 0,
      Blend: 'Overwrite' as const
    }))
  };
}

/**
 * Turns a parameter's display name into something usable as an expression name.
 *
 * Outfit parameters are named in whatever language the author works in — 睡衣,
 * パジャマ — and that name is the most meaningful label available, so it is worth
 * keeping. But it also becomes a filename and a model3.json key, and a runtime
 * reading those is not guaranteed to handle every script. Non-ASCII names are
 * therefore kept only when they survive intact; otherwise the parameter id,
 * which is always ASCII, is the fallback.
 */
export function outfitFileBaseName(parameter: OutfitParameter): string {
  const cleaned = parameter.name
    .trim()
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Replacement to nothing but underscores means the name carried no characters
  // a filename can hold; the id is the honest fallback.
  return cleaned === '' || /^_+$/.test(cleaned) ? parameter.id : cleaned;
}
