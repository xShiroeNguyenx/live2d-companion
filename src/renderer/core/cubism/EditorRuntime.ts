import { CubismFramework } from '@framework/live2dcubismframework';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismPhysics } from '@framework/physics/cubismphysics';
import { CubismPose } from '@framework/effect/cubismpose';
import type { LoadedModel } from './CubismLoader';
import type { Exp3Json } from '@shared/types/live2d-files';
import { HitTester } from './HitTester';
import type { MotionSample } from '../motion/MotionPlayback';
import { ancestorParts, collectPartDrawables, descendantParts } from './ModelInfo';
import { ViewTransform } from './ViewTransform';

/**
 * Which subsystems run each frame. An editor needs these individually
 * switchable: while dragging a slider you usually want physics on but idle
 * motion off, and while tuning physics you want no other source of movement.
 */
export interface RuntimeToggles {
  motion: boolean;
  expressions: boolean;
  physics: boolean;
  pose: boolean;
  mouseFollow: boolean;
}

export const defaultToggles: RuntimeToggles = {
  motion: true,
  expressions: true,
  physics: true,
  pose: true,
  mouseFollow: false
};

/**
 * Where the renderer fetches its GLSL from.
 *
 * Since Cubism 5 R5 the framework keeps its shaders in standalone .vert/.frag
 * files and fetches them at runtime, defaulting to a path relative to the SDK
 * sample layout. `scripts/sync-core.js` copies them into the renderer's public
 * directory, and this is where they land.
 *
 * Resolved against the document URL rather than written as a root-absolute
 * path, because a packaged build loads index.html over `file://`, where a
 * leading slash would point at the filesystem root.
 */
const SHADER_PATH = new URL('./shaders/', document.baseURI).href;

/** An expression the preview is currently applying, with its blend strength. */
export interface ActiveExpression {
  name: string;
  expression: Exp3Json;
  /** 0 to 1; anything below 1 is what a mid-fade looks like. */
  weight: number;
}

/** Parameter ids the mouse-follow test uses, matching the SDK samples. */
const DRAG_PARAMETERS = {
  angleX: 'ParamAngleX',
  angleY: 'ParamAngleY',
  angleZ: 'ParamAngleZ',
  bodyAngleX: 'ParamBodyAngleX',
  eyeBallX: 'ParamEyeBallX',
  eyeBallY: 'ParamEyeBallY'
} as const;

/**
 * Owns the per-frame update order for the preview.
 *
 * The order is the whole point of this class. Authoring overrides are applied
 * after animation sources but before physics, so a slider the user is holding
 * wins over motion while hair still reacts to where that slider put the head.
 * Because every subsystem is rebuilt from the edited JSON, what the preview
 * shows is what an export will contain.
 */
export class EditorRuntime {
  private readonly gl: WebGL2RenderingContext;
  private readonly loaded: LoadedModel;
  private readonly projection = new CubismMatrix44();

  private physics: CubismPhysics | null = null;
  private pose: CubismPose | null = null;

  /** Values the user is authoring right now, by parameter index. */
  private readonly overrides = new Map<number, number>();
  /** Last frame's parameter values as authored, before physics and pose ran. */
  private authoredValues = new Float32Array(0);
  private readonly hitTesterInstance: HitTester;
  private activeExpressions: ActiveExpression[] = [];
  private motionSample: MotionSample | null = null;
  private hiddenParts = new Set<number>();
  private hiddenDrawables = new Set<number>();
  private isolatedPart: number | null = null;
  /** Meshes to keep bright while the rest of the model is dimmed. */
  private isolatedDrawables: Set<number> | null = null;
  /** Part opacities this class overrode last frame, and what they held before. */
  private readonly dimmedLastFrame = new Map<number, number>();
  private dragX = 0;
  private dragY = 0;

  toggles: RuntimeToggles = { ...defaultToggles };

  constructor(gl: WebGL2RenderingContext, loaded: LoadedModel) {
    this.gl = gl;
    this.loaded = loaded;
    this.hitTesterInstance = new HitTester(loaded.model);
  }

  get model() {
    return this.loaded.model;
  }

  get info() {
    return this.loaded.info;
  }

  /**
   * The pose as authored, with physics and pose excluded.
   *
   * Capturing an expression from the drawn values would bake in whatever
   * position the hair physics happened to be in, producing an expression full of
   * parameters the user never touched. This is the snapshot to capture from.
   */
  getAuthoredValues(): Float32Array {
    return this.authoredValues;
  }

  /**
   * Rebuilds the physics simulation from edited physics3.json text.
   *
   * Rebuilding rather than mutating is deliberate: it costs under a millisecond
   * and guarantees the preview reflects the file, with no accumulated state from
   * the previous settings.
   */
  setPhysics(physicsJson: string | null): void {
    this.physics = null;
    if (!physicsJson) return;

    const buffer = new TextEncoder().encode(physicsJson).buffer as ArrayBuffer;
    const physics = CubismPhysics.create(buffer, buffer.byteLength);
    if (!physics) return;

    physics.stabilization(this.loaded.model);
    this.physics = physics;
  }

  setPose(poseJson: string | null): void {
    this.pose = null;
    if (!poseJson) return;

    const buffer = new TextEncoder().encode(poseJson).buffer as ArrayBuffer;
    const pose = CubismPose.create(buffer, buffer.byteLength);
    if (pose) this.pose = pose;
  }

  /** Pin a parameter to a value until it is released. */
  setOverride(parameterIndex: number, value: number): void {
    this.overrides.set(parameterIndex, value);
  }

  clearOverride(parameterIndex: number): void {
    this.overrides.delete(parameterIndex);
  }

  clearAllOverrides(): void {
    this.overrides.clear();
  }

  getOverride(parameterIndex: number): number | undefined {
    return this.overrides.get(parameterIndex);
  }

  /**
   * Mesh opacities with one parameter forced to a value, everything else at
   * its default.
   *
   * Used to work out what a parameter actually controls, which is the only
   * way to find a model's outfit switches: their ids and names carry no
   * reliable signal, but their effect on the artwork does.
   *
   * The live parameter array is saved and put back around the probe. An earlier
   * version relied on the next frame's `loadParameters()` to undo the damage,
   * which is wrong twice over: `loadParameters()` restores the *saved* buffer,
   * not what was in the live array beforehand, and a caller that probes every
   * candidate parameter in one go — which is exactly how outfit detection works
   * — destroys the pose the user is holding before any frame runs. The smoke
   * test caught it as "capturing a pose did not create an expression": the pose
   * had been flattened to defaults before it could be captured.
   */
  probeOpacities(parameterIndex: number, value: number): Float32Array {
    const { model, info } = this.loaded;
    const live = model.getModel().parameters.values;

    // Both buffers have to come back. `loadParameters()` restores the saved one
    // into the live one, so a probe that only puts the live array back is still
    // destructive: the next frame opens with `loadParameters()` and pulls in
    // whatever the probe left saved.
    const liveBefore = Float32Array.from(live);
    model.loadParameters();
    const savedBefore = Float32Array.from(live);

    live.set(model.getModel().parameters.defaultValues);
    live[parameterIndex] = value;
    model.update();
    const probed = Float32Array.from(model.getModel().drawables.opacities);

    live.set(savedBefore);
    model.saveParameters();
    live.set(liveBefore);
    return probed;
  }

  /**
   * Sets which expressions are active and how strongly.
   *
   * Expressions are applied by this class rather than through the framework's
   * expression manager because an editor needs several active at once at
   * arbitrary weights — that is how a user checks whether two expressions fight
   * over the same parameter, which is the single most common authoring mistake.
   */
  setActiveExpressions(expressions: ActiveExpression[]): void {
    this.activeExpressions = expressions;
  }

  /**
   * Sets the motion values to apply this frame, or null to stop applying one.
   *
   * Given as a sampled instant rather than a motion plus a clock, because the
   * timeline owns the playhead: scrubbing has to show the frame under the cursor
   * immediately, which a runtime advancing its own time could not do.
   */
  setMotionSample(sample: MotionSample | null): void {
    this.motionSample = sample;
  }

  /**
   * Sets which parts are hidden, by part index.
   *
   * Applied every frame after pose runs, because pose also writes part
   * opacities: a hidden part must stay hidden even when it belongs to a pose
   * group that would otherwise fade it back in.
   */
  setHiddenParts(partIndices: Iterable<number>): void {
    this.hiddenParts = new Set(partIndices);
  }

  /**
   * Hides individual meshes, by drawable index.
   *
   * Part opacity is the natural way to hide things, but it only reaches whole
   * parts — and many models put a dozen separate garments directly under one
   * part, so hiding the part takes all of them. Writing the Core's per-drawable
   * opacity array is the only way to switch off one jacket while leaving the
   * skirt beside it visible.
   */
  setHiddenDrawables(drawableIndices: Iterable<number>): void {
    this.hiddenDrawables = new Set(drawableIndices);
  }

  /**
   * Dims everything except the given part, so the user can see which part a
   * list row refers to without having to recognise its name.
   *
   * Dimming the rest rather than tinting the target keeps the model readable:
   * a highlight colour on Live2D art is hard to make out, while a faded
   * surround makes the part unmistakable.
   */
  setIsolatedPart(partIndex: number | null): void {
    this.isolatedPart = partIndex;
  }

  /**
   * The same preview as {@link setIsolatedPart}, addressed by mesh.
   *
   * A model whose meshes belong to no part cannot be previewed through part
   * opacity — there is no part to dim — yet that is exactly the model where the
   * user most needs the highlight, because the row they are hovering says only
   * `ArtMesh204`. Dimming by drawable works regardless of the part tree.
   *
   * Pass null to clear.
   */
  setIsolatedDrawables(drawableIndices: Iterable<number> | null): void {
    this.isolatedDrawables = drawableIndices === null ? null : new Set(drawableIndices);
  }

  /**
   * Live particle positions for one physics chain, in model space.
   *
   * The physics editor draws these as a pendulum so the user can see what a
   * chain is doing rather than inferring it from numbers. The framework exposes
   * `_physicsRig` as a public field, so no patch to the vendored SDK is needed —
   * which matters, because a patch would have to be re-applied on every upgrade.
   *
   * Returns an empty array when the chain has not been simulated yet, e.g.
   * physics is toggled off.
   */
  getPhysicsParticles(settingIndex: number): Array<{ x: number; y: number; radius: number }> {
    const rig = this.physics?._physicsRig;
    const setting = rig?.settings[settingIndex];
    if (!rig || !setting) return [];

    const particles: Array<{ x: number; y: number; radius: number }> = [];
    for (let offset = 0; offset < setting.particleCount; offset += 1) {
      const particle = rig.particles[setting.baseParticleIndex + offset];
      if (!particle) continue;
      particles.push({
        x: particle.position.x ?? 0,
        y: particle.position.y ?? 0,
        radius: particle.radius ?? 0
      });
    }
    return particles;
  }

  /** Applies a wind force, for the "shake it and see" physics test rig. */
  setPhysicsWind(x: number, y: number): void {
    const rig = this.physics?._physicsRig;
    if (!rig) return;
    rig.wind.x = x;
    rig.wind.y = y;
  }

  /** Settles the simulation, so a parameter jump does not fling the hair. */
  stabilizePhysics(): void {
    this.physics?.stabilization(this.loaded.model);
  }

  /**
   * Replaces one of the model's textures with edited pixels.
   *
   * Uploads into the existing GL texture rather than creating a new one, so the
   * renderer's binding stays valid and a colour change shows up on the next
   * frame without reloading the model.
   */
  async replaceTexture(
    textureIndex: number,
    source: OffscreenCanvas | ImageBitmap
  ): Promise<void> {
    const entry = this.loaded.textures[textureIndex];
    if (!entry) return;

    const { gl } = this;

    // Select a texture unit explicitly. The framework's renderer leaves whatever
    // unit it last used active, so binding without choosing one first would
    // upload over one of its textures instead of ours — the edit would appear to
    // do nothing while quietly corrupting something else.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, entry.glTexture);
    // Must match how the texture was first uploaded, or the edited region comes
    // out darker than the rest.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.generateMipmap(gl.TEXTURE_2D);
    // Leave the flag off: the framework uploads its own textures with it unset,
    // and a stale setting would darken anything it loads afterwards.
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Normalised drag position in [-1, 1], used by the mouse-follow test. */
  setDrag(x: number, y: number): void {
    this.dragX = Math.max(-1, Math.min(1, x));
    this.dragY = Math.max(-1, Math.min(1, y));
  }

  /** Reset every parameter to the value baked into the moc. */
  resetToDefaults(): void {
    const { model, info } = this.loaded;
    for (const parameter of info.parameters) {
      model.setParameterValueByIndex(parameter.index, parameter.default);
    }
    model.saveParameters();
    this.physics?.stabilization(model);
  }

  /** One frame: run the pipeline, then draw. */
  update(deltaSeconds: number, view: ViewTransform, canvasWidth: number, canvasHeight: number): void {
    const { model } = this.loaded;

    // Restore the previous frame's authored base, so animation sources layer on
    // top of it rather than on whatever physics left behind.
    model.loadParameters();

    // Motion runs first among the animation sources, so an expression layered
    // on top of it adds to the pose the motion produced — which is how the two
    // combine at runtime.
    if (this.toggles.motion) this.applyMotion();
    if (this.toggles.mouseFollow) this.applyMouseFollow();
    if (this.toggles.expressions) this.applyExpressions();

    // Authoring overrides come last among parameter sources: whatever the user
    // is holding must win.
    for (const [index, value] of this.overrides) {
      model.setParameterValueByIndex(index, value);
    }

    model.saveParameters();

    // Snapshot the authored pose before physics and pose run. This is what an
    // expression must be captured from: the values the user actually set, not
    // the post-physics result, which drifts on every frame as hair settles.
    const values = model.getModel().parameters.values;
    if (this.authoredValues.length !== values.length) {
      this.authoredValues = new Float32Array(values.length);
    }
    this.authoredValues.set(values);

    if (this.toggles.physics && this.physics) {
      this.physics.evaluate(model, deltaSeconds);
    }
    if (this.toggles.pose && this.pose) {
      this.pose.updateParameters(model, deltaSeconds);
    }

    // Part visibility comes after pose on purpose: pose writes part opacities
    // too, and the user's explicit hide has to win over it.
    this.applyPartVisibility();

    model.update();

    // After update(), because that is what recomputes drawable opacities from
    // the deformers — writing earlier would be overwritten every frame.
    this.applyDrawableVisibility();

    this.draw(view, canvasWidth, canvasHeight);
  }

  /**
   * Applies the active expressions in order, honouring each entry's blend mode.
   *
   * The blend semantics mirror the framework's own expression motion: Add and
   * Multiply scale with weight from their neutral value (0 and 1), and
   * Overwrite interpolates from whatever the parameter already holds — so a
   * half-weight overwrite lands halfway, which is what a fade looks like.
   */
  private applyExpressions(): void {
    const { model } = this.loaded;
    const idManager = CubismFramework.getIdManager();

    for (const expression of this.activeExpressions) {
      const weight = Math.max(0, Math.min(1, expression.weight));
      if (weight === 0) continue;

      for (const parameter of expression.expression.Parameters) {
        const id = idManager.getId(parameter.Id);
        switch (parameter.Blend ?? 'Add') {
          case 'Add':
            model.addParameterValueById(id, parameter.Value * weight);
            break;
          case 'Multiply':
            model.multiplyParameterValueById(
              id,
              1 + (parameter.Value - 1) * weight
            );
            break;
          case 'Overwrite':
            model.setParameterValueById(id, parameter.Value, weight);
            break;
        }
      }
    }
  }

  /** How faint the rest of the model goes while one part is isolated. */
  private static readonly DIMMED_OPACITY = 0.15;

  /**
   * Enforces hidden parts and the isolate-one-part preview.
   *
   * The rule that matters here: part opacity **multiplies down the hierarchy**.
   * A part nested three levels deep is drawn at the product of its own opacity
   * and all its ancestors', so writing 0.15 to every part in a chain gives
   * 0.15³ ≈ 0.003 — effectively invisible. Models with deep part trees (a PSD
   * imported with nested folders, say) therefore vanish entirely if each part is
   * dimmed independently.
   *
   * So both operations write to the *topmost* part that needs changing and leave
   * its descendants alone: they inherit the effect exactly once.
   *
   * Every part the previous frame touched is also restored first. Part opacity
   * is state on the model, not something recomputed each frame like a parameter,
   * so a value written once stays written — clearing the isolation would
   * otherwise leave the model permanently dimmed.
   */
  private applyPartVisibility(): void {
    const { model, info } = this.loaded;

    // Put back what was changed last frame, using the value that was there
    // before we touched it rather than assuming 1: pose groups and motion
    // curves also write part opacities, and clobbering those with 1 would
    // override a cross-fade or an animated fade-out.
    for (const [partIndex, original] of this.dimmedLastFrame) {
      model.setPartOpacityByIndex(partIndex, original);
    }
    this.dimmedLastFrame.clear();

    /** Dims a part, remembering what it held so the next frame can restore it. */
    const dim = (partIndex: number, opacity: number): void => {
      if (!this.dimmedLastFrame.has(partIndex)) {
        this.dimmedLastFrame.set(partIndex, model.getPartOpacityByIndex(partIndex));
      }
      model.setPartOpacityByIndex(partIndex, opacity);
    };

    if (this.isolatedPart !== null) {
      const keepVisible = new Set(descendantParts(info, this.isolatedPart));
      // Also keep the ancestors at full opacity: dimming a parent would dim the
      // isolated part along with it.
      for (const ancestor of ancestorParts(info, this.isolatedPart)) {
        keepVisible.add(ancestor);
      }

      for (const part of info.parts) {
        if (keepVisible.has(part.index)) continue;
        // Only dim a part whose parent is not itself being dimmed, so the
        // multiplication happens once rather than once per level.
        if (part.parentIndex >= 0 && !keepVisible.has(part.parentIndex)) continue;
        dim(part.index, EditorRuntime.DIMMED_OPACITY);
      }
    }

  }

  /**
   * Zeroes the opacity of individually hidden meshes.
   *
   * Writes straight into the Core's opacity array: the framework exposes a
   * getter but no setter, and the renderer reads this array when it draws, so
   * this is the seam that makes per-mesh hiding possible at all.
   */
  private applyDrawableVisibility(): void {
    const { info } = this.loaded;

    // A hidden part is resolved to its meshes rather than relying on part
    // opacity. Part opacity is recomputed by the model's own deformers after we
    // write it, and on some models setting it has no visible effect at all —
    // zeroing the drawables is what reliably removes the artwork.
    const hidden = new Set(this.hiddenDrawables);
    for (const partIndex of this.hiddenParts) {
      for (const drawableIndex of collectPartDrawables(info, partIndex)) {
        hidden.add(drawableIndex);
      }
    }
    const isolated = this.isolatedDrawables;
    if (hidden.size === 0 && (isolated === null || isolated.size === 0)) return;

    const opacities = this.loaded.model.getModel().drawables.opacities;
    // Dim first, then hide: a mesh that is both isolated and hidden should stay
    // hidden, and writing 0 last is what guarantees that.
    if (isolated !== null && isolated.size > 0) {
      for (let index = 0; index < opacities.length; index += 1) {
        if (!isolated.has(index)) opacities[index] *= EditorRuntime.DIMMED_OPACITY;
      }
    }
    for (const index of hidden) {
      if (index >= 0 && index < opacities.length) opacities[index] = 0;
    }
  }

  /** Writes a sampled motion instant into the model. */
  private applyMotion(): void {
    const sample = this.motionSample;
    if (!sample) return;

    const { model, info } = this.loaded;
    const idManager = CubismFramework.getIdManager();

    for (const [id, value] of sample.parameters) {
      model.setParameterValueById(idManager.getId(id), value);
    }
    for (const [id, value] of sample.partOpacities) {
      const part = info.parts.find((entry) => entry.id === id);
      if (part) model.setPartOpacityByIndex(part.index, value);
    }
    // The only model-level curve in practice is Opacity, and the framework
    // spells its setter with a typo we have to match.
    const opacity = sample.model.get('Opacity');
    if (opacity !== undefined) model.setModelOapcity(opacity);
  }

  private applyMouseFollow(): void {
    const { model } = this.loaded;
    const idManager = CubismFramework.getIdManager();

    model.addParameterValueById(idManager.getId(DRAG_PARAMETERS.angleX), this.dragX * 30);
    model.addParameterValueById(idManager.getId(DRAG_PARAMETERS.angleY), this.dragY * 30);
    model.addParameterValueById(
      idManager.getId(DRAG_PARAMETERS.angleZ),
      this.dragX * this.dragY * -30
    );
    model.addParameterValueById(idManager.getId(DRAG_PARAMETERS.bodyAngleX), this.dragX * 10);
    model.addParameterValueById(idManager.getId(DRAG_PARAMETERS.eyeBallX), this.dragX);
    model.addParameterValueById(idManager.getId(DRAG_PARAMETERS.eyeBallY), this.dragY);
  }

  /**
   * Converts a clip-space point (what a pointer event maps to) into the model's
   * own coordinate space, which is what drawable vertices are expressed in.
   *
   * Uses the projection from the last drawn frame, so picking always agrees
   * with what is on screen — including the current zoom and pan.
   */
  clipToModel(clipX: number, clipY: number): { x: number; y: number } {
    return {
      x: this.projection.invertTransformX(clipX),
      y: this.projection.invertTransformY(clipY)
    };
  }

  /** Maps a model-space point back to clip space, for drawing overlays. */
  modelToClip(modelX: number, modelY: number): { x: number; y: number } {
    return {
      x: this.projection.transformX(modelX),
      y: this.projection.transformY(modelY)
    };
  }

  get hitTester(): HitTester {
    return this.hitTesterInstance;
  }

  private draw(view: ViewTransform, canvasWidth: number, canvasHeight: number): void {
    const { gl, loaded, projection } = this;

    const { canvas } = loaded.info;

    projection.loadIdentity();
    // Fit the model's own canvas into the viewport without distorting it, then
    // let the view matrix apply the user's zoom and pan on top.
    //
    // A model's coordinate space is `canvasWidth` units wide (2.0 for a square
    // canvas), and clip space spans 2.0 in each axis. Tall models such as
    // Hiyori are much taller than they are wide, so scaling by width alone
    // would push the head and feet off screen; taking the smaller of the two
    // fits whichever axis is the binding constraint.
    const viewportAspect = canvasWidth / canvasHeight;
    const modelAspect = canvas.widthUnit / canvas.heightUnit;
    const fitScale =
      modelAspect > viewportAspect
        ? 2 / canvas.widthUnit
        : (2 / canvas.heightUnit) * (1 / viewportAspect);

    projection.scale(fitScale, fitScale * viewportAspect);
    projection.multiplyByMatrix(view.matrix);

    loaded.renderer.setMvpMatrix(projection);
    // `null` is the default framebuffer — the framework's signature does not
    // admit it, but that is exactly what drawing to the canvas requires.
    loaded.renderer.setRenderState(
      null as unknown as WebGLFramebuffer,
      [0, 0, canvasWidth, canvasHeight]
    );
    // The shader path has to be passed on every draw: the framework re-checks
    // it and silently skips drawing until the fetched shaders have compiled.
    loaded.renderer.drawModel(SHADER_PATH);

    void gl;
  }
}
