import { useEffect, useRef } from 'react';
import { loadModel, releaseModel, type LoadedModel } from '../../core/cubism/CubismLoader';
import { loadModelAssets } from '../../core/cubism/ModelAssets';
import { EditorRuntime } from '../../core/cubism/EditorRuntime';
import { OverlayRenderer } from '../../core/cubism/OverlayRenderer';
import { ViewTransform } from '../../core/cubism/ViewTransform';
import { useSessionStore } from '../../document/stores/sessionStore';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import {
  expressionsStore,
  model3Store,
  motionsStore,
  physics3Store,
  pose3Store
} from '../../document/stores/documentStores';
import { useMotionUiStore } from '../../document/stores/motionUiStore';
import { advance, sampleMotion } from '../../core/motion/MotionPlayback';
import { loadDocumentsFromAssets } from '../../document/loadSession';
import { deliverDrawablePick } from '../../document/canvasPick';
import { recordFrameNow } from '../../document/motionRecorder';
import { runtimeRef } from '../../document/runtimeRef';

/** How often the parameter sliders re-read values from the runtime. */
const UI_SYNC_INTERVAL_MS = 100;

/** How long document edits settle before a runtime subsystem is rebuilt. */
const REBUILD_DEBOUNCE_MS = 150;

/**
 * The live model view.
 *
 * This component owns the GL context and the animation loop; every other panel
 * talks to the model through the shared runtime reference rather than reaching
 * in here.
 */
export function PreviewCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const workspace = useSessionStore((state) => state.workspace);
  const status = useSessionStore((state) => state.status);
  const canvasMode = useEditorUiStore((state) => state.canvasMode);

  useEffect(() => {
    if (!workspace || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      // Keeps the drawing buffer readable after a frame ends, which is how the
      // smoke test verifies the model actually rendered.
      preserveDrawingBuffer: true
    });
    if (!gl) {
      useSessionStore.getState().setError('Không khởi tạo được WebGL2.');
      return;
    }

    const view = new ViewTransform();
    let loaded: LoadedModel | null = null;
    let runtime: EditorRuntime | null = null;
    let frameHandle = 0;
    let disposed = false;
    let unsubscribePhysics: (() => void) | null = null;
    let unsubscribePose: (() => void) | null = null;
    const overlay = overlayCanvasRef.current
      ? new OverlayRenderer(overlayCanvasRef.current)
      : null;

    // Coalesces bursts of document edits into one rebuild per subsystem.
    const rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleRebuild = (key: string, rebuild: () => void): void => {
      const existing = rebuildTimers.get(key);
      if (existing) clearTimeout(existing);
      rebuildTimers.set(
        key,
        setTimeout(() => {
          rebuildTimers.delete(key);
          if (!disposed) rebuild();
        }, REBUILD_DEBOUNCE_MS)
      );
    };

    const resize = (): void => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    const start = async (): Promise<void> => {
      const store = useSessionStore.getState();
      store.beginLoading(workspace);

      try {
        const assets = await loadModelAssets(workspace.id, workspace.modelSettingFile);
        if (disposed) return;

        resize();
        loaded = loadModel({
          gl,
          mocBuffer: assets.mocBuffer,
          modelSetting: assets.modelSetting.data,
          displayInfo: assets.displayInfo?.data ?? null,
          textureImages: assets.textureImages
        });

        runtime = new EditorRuntime(gl, loaded);
        runtime.setPhysics(assets.physics?.text ?? null);
        runtime.setPose(assets.pose?.text ?? null);
        runtime.resetToDefaults();
        runtimeRef.current = runtime;

        // Documents load after the model so the stores can validate their ids
        // against the moc, and so a failed model load leaves no half-populated
        // editor state behind.
        loadDocumentsFromAssets(workspace.id, assets);

        store.setReady(
          loaded.info,
          loaded.model.getModel().parameters.values,
          assets.baseDir,
          loaded.textures.map((texture) => ({
            width: texture.width,
            height: texture.height
          }))
        );

        if (assets.missing.length > 0) {
          console.warn('[preview] referenced files missing:', assets.missing);
        }

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        let lastTime = performance.now();
        let lastSync = lastTime;
        let lastRecord = lastTime;

        const frame = (now: number): void => {
          if (disposed || !runtime) return;

          const delta = Math.min(0.1, (now - lastTime) / 1000);
          lastTime = now;

          resize();
          runtime.toggles = useSessionStore.getState().toggles;

          // The expression selection lives in a UI store rather than being
          // pushed into the runtime, so reading it each frame keeps the preview
          // in step with the checkboxes without any subscription plumbing.
          const ui = useEditorUiStore.getState();
          const set = expressionsStore.getState().data;
          runtime.setActiveExpressions(
            Object.entries(ui.activeExpressions)
              .filter(([name]) => set.byName[name])
              .map(([name, weight]) => ({ name, expression: set.byName[name], weight }))
          );

          // Motion playback: the timeline owns the playhead, so the loop
          // advances it and hands the runtime the sampled instant. Doing it here
          // rather than in the runtime keeps scrubbing and playing on one path.
          const motionUi = useMotionUiStore.getState();
          const activeMotion = motionUi.activePath
            ? motionsStore.getState().data.byPath[motionUi.activePath]
            : null;

          if (activeMotion) {
            if (motionUi.playing) {
              const next = advance(motionUi, delta, activeMotion.duration);
              motionUi.setTime(next.time);
              if (!next.playing) motionUi.setPlaying(false);
            }
            runtime.setMotionSample(
              sampleMotion(activeMotion, useMotionUiStore.getState().time)
            );

            // Recording samples at a fixed rate rather than every frame: a
            // 60fps capture would produce twice the keyframes a 30fps motion can
            // express, and the extra ones would only add noise to clean up.
            if (motionUi.recording && now - lastRecord >= 1000 / activeMotion.fps) {
              lastRecord = now;
              recordFrameNow();
            }
          } else {
            runtime.setMotionSample(null);
          }

          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

          runtime.update(delta, view, canvas.width, canvas.height);

          // Gizmos are drawn after the model, on their own 2D layer, and only
          // when a mode actually needs them.
          if (overlay && overlayCanvasRef.current) {
            overlay.resize(canvas.width, canvas.height);
            overlay.clear();
            if (ui.canvasMode === 'pickDrawable' && ui.hoveredDrawable !== null) {
              overlay.drawHighlights(runtime, [
                {
                  drawableIndex: ui.hoveredDrawable,
                  label: runtime.info.drawables[ui.hoveredDrawable]?.id
                }
              ]);
            } else if (ui.selectedPhysicsChain !== null) {
              // The physics panel draws the chain being tuned, so the user can see
              // which of dozens of chains they are changing.
              overlay.drawPhysicsChain(
                runtime,
                runtime.getPhysicsParticles(ui.selectedPhysicsChain)
              );
            } else if (ui.canvasMode === 'testHitAreas') {
              const areas = model3Store.getState().data.HitAreas ?? [];
              const byId = new Map(
                runtime.info.drawables.map((drawable) => [drawable.id, drawable.index])
              );
              overlay.drawHighlights(
                runtime,
                areas
                  .map((area) => ({ area, index: byId.get(area.Id) }))
                  .filter((entry) => entry.index !== undefined)
                  .map((entry) => ({
                    drawableIndex: entry.index as number,
                    label: entry.area.Name
                  }))
              );
            }
          }

          // Sliders only need to follow physics at UI rates, not every frame.
          if (now - lastSync > UI_SYNC_INTERVAL_MS) {
            lastSync = now;
            useSessionStore
              .getState()
              .syncParameterValues(runtime.model.getModel().parameters.values);
          }

          frameHandle = requestAnimationFrame(frame);
        };

        frameHandle = requestAnimationFrame(frame);

        // Editing physics or pose rebuilds the corresponding runtime object from
        // the edited JSON. Rebuilding rather than patching is what guarantees the
        // preview matches the file that will be exported, and it costs well under
        // a millisecond, so a debounce is enough to keep dragging smooth.
        unsubscribePhysics = physics3Store.subscribe((state) => {
          if (!runtime || !state.relativePath) return;
          scheduleRebuild('physics', () =>
            runtime?.setPhysics(JSON.stringify(state.data))
          );
        });
        unsubscribePose = pose3Store.subscribe((state) => {
          if (!runtime || !state.relativePath) return;
          scheduleRebuild('pose', () => runtime?.setPose(JSON.stringify(state.data)));
        });
      } catch (error) {
        console.error('[preview] model load failed', error);
        if (!disposed) {
          useSessionStore
            .getState()
            .setError(error instanceof Error ? error.message : String(error));
        }
      }
    };

    // Pointer interaction: wheel zooms about the cursor, drag pans, and with
    // mouse-follow on, drag steers the model's gaze instead.
    const toClip = (event: PointerEvent | WheelEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      };
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const clip = toClip(event);
      view.zoomAt(clip.x, clip.y, event.deltaY < 0 ? 1.1 : 1 / 1.1);
    };

    let dragging = false;
    let lastClip = { x: 0, y: 0 };

    const onPointerDown = (event: PointerEvent): void => {
      const clip = toClip(event);
      const mode = useEditorUiStore.getState().canvasMode;

      if (mode !== 'none' && runtime) {
        const model = runtime.clipToModel(clip.x, clip.y);

        if (mode === 'pickDrawable') {
          const picked = runtime.hitTester.pickDrawable(model.x, model.y);
          if (picked !== null) {
            deliverDrawablePick(runtime.info.drawables[picked].id);
          }
          return;
        }

        if (mode === 'testHitAreas') {
          // Report using the bounding-box rule the runtime uses, so the answer
          // matches what a companion app or VTube Studio would do.
          const areas = model3Store.getState().data.HitAreas ?? [];
          const byId = new Map(
            runtime.info.drawables.map((drawable) => [drawable.id, drawable.index])
          );
          const hit = areas.find((area) => {
            const index = byId.get(area.Id);
            return (
              index !== undefined && runtime!.hitTester.hitTestBounds(index, model.x, model.y)
            );
          });
          useEditorUiStore
            .getState()
            .setLastHitTest(
              hit ? { areaName: hit.Name, drawableId: hit.Id } : null
            );
          return;
        }
      }

      dragging = true;
      lastClip = clip;
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      const clip = toClip(event);
      const mode = useEditorUiStore.getState().canvasMode;

      // While picking, the cursor outlines whatever mesh it is over so the user
      // can tell what a click would actually select.
      if (mode === 'pickDrawable' && runtime) {
        const model = runtime.clipToModel(clip.x, clip.y);
        const picked = runtime.hitTester.pickDrawable(model.x, model.y);
        if (picked !== useEditorUiStore.getState().hoveredDrawable) {
          useEditorUiStore.getState().setHoveredDrawable(picked);
        }
      }

      if (useSessionStore.getState().toggles.mouseFollow) {
        runtime?.setDrag(clip.x, clip.y);
        if (!dragging) return;
      }
      if (!dragging) return;
      view.pan(clip.x - lastClip.x, clip.y - lastClip.y);
      lastClip = clip;
    };

    const onPointerUp = (event: PointerEvent): void => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    const onDoubleClick = (): void => view.fit();

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);

    void start();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameHandle);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      unsubscribePhysics?.();
      unsubscribePose?.();
      for (const timer of rebuildTimers.values()) clearTimeout(timer);
      rebuildTimers.clear();
      runtimeRef.current = null;
      if (loaded) releaseModel(gl, loaded);
    };
  }, [workspace]);

  return (
    <div className={`preview${canvasMode !== 'none' ? ' preview--picking' : ''}`}>
      <canvas ref={canvasRef} className="preview__canvas" />
      {/* Gizmos live on their own layer so they never appear in a capture of
          the model, and so pointer events keep going to the GL canvas. */}
      <canvas ref={overlayCanvasRef} className="preview__gizmos" />
      {status === 'loading' && <div className="preview__overlay">Đang tải model…</div>}
      {canvasMode === 'pickDrawable' && (
        <div className="preview__mode">Bấm vào phần muốn chọn trên model</div>
      )}
      {canvasMode === 'testHitAreas' && (
        <div className="preview__mode">Bấm để thử vùng chạm</div>
      )}
    </div>
  );
}
