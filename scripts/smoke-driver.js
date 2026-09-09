/**
 * Electron entry used only by `scripts/smoke-test.js`.
 *
 * It boots the real main process, then drives the renderer through an actual
 * import + model load and captures the canvas. A window opening proves nothing;
 * this asserts the WebGL path, the Cubism Core load and the renderer all work.
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const screenshotPath = path.join(projectRoot, '.smoke', 'preview.png');

// CI and headless machines have no real GPU; allow the software rasteriser.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(message) {
  console.error(`SMOKE FAIL: ${message}`);
  app.exit(1);
}

async function waitForWindow(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [window] = BrowserWindow.getAllWindows();
    if (window) return window;
    await sleep(250);
  }
  return null;
}

async function main() {
  require(path.join(projectRoot, 'out', 'main', 'index.js'));

  const window = await waitForWindow(30000);
  if (!window) return fail('no window appeared');

  // Surface renderer-side errors; without this a failed load is just a timeout.
  // Electron 36+ passes a details object here, older versions pass positional
  // arguments, so accept either shape.
  window.webContents.on('console-message', (...args) => {
    const details = args[0];
    const message =
      details && typeof details === 'object' && 'message' in details
        ? `${details.level ?? ''} ${details.message}`
        : `${args[1]} ${args[2]}`;
    console.error(`[renderer] ${message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) =>
    console.error('[renderer gone]', JSON.stringify(details))
  );

  if (window.webContents.isLoading()) {
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  }

  const imported = await window.webContents.executeJavaScript(
    `(async () => {
      const samplePath = await window.api.sampleModelPath();
      const probe = await window.api.probeImport(samplePath);
      if (!probe.ok) return { ok: false, stage: 'probe', error: probe.error };
      const result = await window.api.importModel(probe.candidates[0]);
      if (!result.ok) return { ok: false, stage: 'import', error: result.error };
      return { ok: true, workspace: result.workspace };
    })()`
  );

  if (!imported.ok) return fail(`${imported.stage}: ${imported.error}`);
  console.log('imported workspace:', imported.workspace.id);

  const ready = await window.webContents.executeJavaScript(
    `(async () => {
      const store = window.__sessionStore;
      if (!store) return { ok: false, error: 'session store not exposed' };
      store.getState().beginLoading(${JSON.stringify(imported.workspace)});
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        const state = store.getState();
        if (state.status === 'ready') {
          return {
            ok: true,
            mocVersion: state.info.mocVersion,
            parameters: state.info.parameters.length,
            parts: state.info.parts.length,
            drawables: state.info.drawables.length,
            usesMasking: state.info.usesMasking
          };
        }
        if (state.status === 'error') return { ok: false, error: state.error };
      }
      const last = store.getState();
      return {
        ok: false,
        error: 'timed out waiting for status=ready',
        lastStatus: last.status,
        lastWorkspace: last.workspace ? last.workspace.id : null,
        canvasPresent: !!document.querySelector('canvas')
      };
    })()`
  );

  if (!ready.ok) return fail(`model did not load — ${JSON.stringify(ready)}`);
  console.log('model ready:', JSON.stringify(ready));

  // Let the render loop produce frames, including time for the framework to
  // fetch and compile its shaders.
  await sleep(4000);

  const image = await window.webContents.capturePage();
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  fs.writeFileSync(screenshotPath, image.toPNG());
  console.log(`screenshot: ${screenshotPath}`);

  // Measuring the whole window would pass on the background alone, so sample
  // the WebGL canvas itself and count pixels the model actually drew. The
  // canvas is cleared to transparent each frame, so any alpha is the model.
  const drawn = await window.webContents.executeJavaScript(
    `(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return { ok: false, error: 'no canvas element' };
      const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
      if (!gl) return { ok: false, error: 'no webgl2 context' };
      // Sample a centred region rather than the full buffer to keep the
      // readback cheap on large canvases.
      const size = Math.min(512, canvas.width, canvas.height);
      const x = Math.floor((canvas.width - size) / 2);
      const y = Math.floor((canvas.height - size) / 2);
      const pixels = new Uint8Array(size * size * 4);
      gl.readPixels(x, y, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let opaque = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 16) opaque += 1;
      return {
        ok: true,
        canvas: { width: canvas.width, height: canvas.height },
        sampled: size * size,
        opaque,
        coverage: opaque / (size * size)
      };
    })()`
  );

  if (!drawn.ok) return fail(`could not sample canvas — ${drawn.error}`);

  console.log(
    `canvas ${drawn.canvas.width}x${drawn.canvas.height}, ` +
      `model pixels in centre sample: ${(drawn.coverage * 100).toFixed(1)}%`
  );

  if (drawn.coverage < 0.02) {
    return fail('canvas has no model pixels — nothing was rendered');
  }

  // --- Phase 1: the editing path -----------------------------------------
  //
  // Rendering a model proves the runtime works; it says nothing about whether an
  // edit reaches the model, the undo stack and the disk. This drives a real
  // capture-an-expression flow and checks all three.
  const edited = await window.webContents.executeJavaScript(
    `(async () => {
      const store = window.__sessionStore;
      const testApi = window.__editorTestApi;
      if (!testApi) return { ok: false, error: 'editor test api not exposed' };

      const info = store.getState().info;
      // Pick a parameter with real range so the change is visible on screen.
      const target = info.parameters.find((p) => p.maximum - p.minimum >= 1);
      if (!target) return { ok: false, error: 'no parameter with usable range' };

      const posed = target.default === target.maximum ? target.minimum : target.maximum;
      testApi.setParameter(target.index, posed);

      // Wait for the value to reach the authored snapshot rather than for a
      // fixed delay. Capture reads that snapshot, and it is only written once
      // the render loop has run a frame — on a slow or headless machine a
      // fixed 400ms sometimes elapsed before the first frame did, and capture
      // then saw the default pose and wrote nothing.
      const posedDeadline = Date.now() + 8000;
      while (
        Math.abs(testApi.authoredValue(target.index) - posed) > 1e-3 &&
        Date.now() < posedDeadline
      ) {
        await new Promise((r) => setTimeout(r, 50));
      }

      const before = testApi.expressionCount();
      testApi.captureExpression();

      // Same again for the store: the edit goes through immer and a zustand
      // notification before the count changes.
      const countDeadline = Date.now() + 4000;
      while (testApi.expressionCount() === before && Date.now() < countDeadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const after = testApi.expressionCount();

      const created = testApi.expressionNames().at(-1) ?? null;
      const undoBefore = testApi.undoState();

      // Activate it and confirm the runtime applies it.
      testApi.clearParameters();
      if (created) testApi.activateExpression(created);
      await new Promise((r) => setTimeout(r, 600));
      const appliedValue = testApi.parameterValue(target.index);

      // Flush autosave and read the file back through the real IPC path.
      await testApi.flushSave();
      const written = created ? await testApi.readFile(testApi.expressionFile(created)) : null;

      // Undo must remove the expression again.
      testApi.undo();
      testApi.undo();
      await new Promise((r) => setTimeout(r, 200));
      const afterUndo = testApi.expressionCount();

      return {
        ok: true,
        parameter: target.id,
        posedValue: posed,
        defaultValue: target.default,
        expressionsBefore: before,
        expressionsAfter: after,
        created,
        appliedValue,
        undoWasAvailable: undoBefore.canUndo,
        expressionsAfterUndo: afterUndo,
        writtenFile: written ? JSON.parse(written) : null
      };
    })()`
  );

  if (!edited.ok) return fail(`editing flow failed — ${edited.error}`);
  const writtenParameters = edited.writtenFile?.Parameters ?? [];
  console.log(
    'edit flow:',
    JSON.stringify(
      { ...edited, writtenFile: `${writtenParameters.length} parameters` },
      null,
      2
    )
  );
  console.log('captured parameters:', writtenParameters.map((p) => p.Id).join(', '));

  if (edited.expressionsAfter !== edited.expressionsBefore + 1) {
    return fail('capturing a pose did not create an expression');
  }
  if (!edited.writtenFile || !Array.isArray(edited.writtenFile.Parameters)) {
    return fail('captured expression was not written to disk as valid exp3.json');
  }
  if (writtenParameters.length === 0) {
    return fail('written expression recorded no parameters');
  }
  // Capturing one posed parameter must record one parameter. More than that
  // means physics-driven values leaked into the capture, which would make every
  // expression carry a frozen snapshot of wherever the hair happened to be.
  if (writtenParameters.length !== 1) {
    return fail(
      `capture recorded ${writtenParameters.length} parameters after posing one ` +
        `(physics values leaking into the capture?)`
    );
  }
  if (writtenParameters[0].Id !== edited.parameter) {
    return fail(
      `capture recorded ${writtenParameters[0].Id} instead of ${edited.parameter}`
    );
  }
  // The captured expression must reproduce the pose it was captured from.
  const tolerance = Math.abs(edited.posedValue - edited.defaultValue) * 0.1 + 0.01;
  if (Math.abs(edited.appliedValue - edited.posedValue) > tolerance) {
    return fail(
      `activating the expression did not reproduce the pose ` +
        `(expected ~${edited.posedValue}, got ${edited.appliedValue})`
    );
  }
  if (!edited.undoWasAvailable) return fail('undo was not available after an edit');
  if (edited.expressionsAfterUndo !== edited.expressionsBefore) {
    return fail('undo did not remove the created expression');
  }

  // --- Model config + export ---------------------------------------------
  //
  // Export is the only thing this app writes outside its own workspace, so it
  // gets checked against the real filesystem: the folder must appear, contain a
  // loadable model, and contain none of the app's private bookkeeping files.
  const exportDir = path.join(projectRoot, '.smoke', 'exported');
  fs.rmSync(exportDir, { recursive: true, force: true });
  fs.mkdirSync(exportDir, { recursive: true });

  const exported = await window.webContents.executeJavaScript(
    `(async () => {
      const api = window.__editorTestApi;
      const info = window.__sessionStore.getState().info;

      // Configure the model the way the config panel does.
      api.addHitArea(info.drawables[0].id, 'Head');
      api.applyGroupSuggestions();
      await new Promise((r) => setTimeout(r, 200));

      const before = api.validate();
      const result = await api.exportTo(${JSON.stringify(exportDir)}, 'smoke-model');
      return { validation: before, result };
    })()`
  );

  console.log('validation:', JSON.stringify(exported.validation, null, 2));
  console.log('export result:', JSON.stringify(exported.result));

  if (!exported.result?.ok) {
    return fail(`export failed — ${exported.result?.error}`);
  }
  if (exported.validation.errors !== 0) {
    return fail(
      `validation reported errors on a clean model: ${exported.validation.messages.join('; ')}`
    );
  }

  const exportedPath = exported.result.exportedPath;
  const modelFile = fs
    .readdirSync(exportedPath)
    .find((entry) => entry.endsWith('.model3.json'));
  if (!modelFile) return fail('exported folder has no model3.json');

  const model3 = JSON.parse(fs.readFileSync(path.join(exportedPath, modelFile), 'utf8'));
  if (!model3.FileReferences?.Moc) return fail('exported model3.json has no moc reference');
  if (!fs.existsSync(path.join(exportedPath, model3.FileReferences.Moc))) {
    return fail('exported model3.json references a moc that was not copied');
  }
  if (!(model3.HitAreas ?? []).some((area) => area.Name === 'Head')) {
    return fail('the configured hit area did not reach the exported model3.json');
  }
  if (!(model3.Groups ?? []).some((group) => group.Name === 'LipSync')) {
    return fail('the LipSync group did not reach the exported model3.json');
  }

  // The workspace's private files must never be handed to the user.
  for (const secret of ['.l2dproj.json', '.backups', '.layers']) {
    if (fs.existsSync(path.join(exportedPath, secret))) {
      return fail(`export leaked an app-private entry: ${secret}`);
    }
  }
  const strayTemp = fs
    .readdirSync(exportedPath)
    .find((entry) => /\.tmp-[0-9a-f]{8}$/i.test(entry));
  if (strayTemp) return fail(`export included a temp file: ${strayTemp}`);

  console.log(
    `exported ${exported.result.fileCount} files to ${exportedPath}, model3 verified`
  );

  // --- Phase 2: motion playback and recording ----------------------------
  //
  // Playing a motion has to visibly move the model, and recording has to write
  // keyframes that reproduce what the user did. Both are checked against
  // measured values rather than the absence of an error.
  const motionResult = await window.webContents.executeJavaScript(
    `(async () => {
      const api = window.__editorTestApi;
      const paths = api.motionPaths();
      if (paths.length === 0) return { ok: false, error: 'no motions loaded' };

      const path = paths[0];
      const before = api.motionInfo(path);
      api.openMotion(path);
      await new Promise((r) => setTimeout(r, 400));

      // Sample the same parameter at two times in the motion; a real curve must
      // differ between them.
      const store = window.__sessionStore.getState();
      const info = store.info;

      // Find a track whose curve actually moves, so the check is meaningful.
      let probe = null;
      for (const parameter of info.parameters) {
        const a = api.motionValueAt(path, parameter.id, before.duration * 0.25);
        const b = api.motionValueAt(path, parameter.id, before.duration * 0.75);
        if (a !== null && b !== null && Math.abs(a - b) > 1) {
          probe = { id: parameter.id, index: parameter.index, a, b };
          break;
        }
      }
      if (!probe) return { ok: false, error: 'no moving curve found in motion' };

      // Seek to each of those times and read the value off the live model.
      api.seekMotion(before.duration * 0.25);
      await new Promise((r) => setTimeout(r, 350));
      const liveA = api.parameterValue(probe.index);

      api.seekMotion(before.duration * 0.75);
      await new Promise((r) => setTimeout(r, 350));
      const liveB = api.parameterValue(probe.index);

      // Recording: pin a parameter, hold it at a value, capture a frame.
      api.clearParameters();
      const target = info.parameters.find((p) => p.maximum - p.minimum >= 1);
      api.seekMotion(0.5);
      api.setParameter(target.index, target.maximum);
      window.__sessionStore.getState().togglePin(target.index);
      await new Promise((r) => setTimeout(r, 400));

      // Between the motion own keyframes so the capture inserts rather than
      // replaces, and exactly on the frame grid so reading back samples the
      // keyframe that was written instead of interpolating around it.
      const doc = api.motionInfo(path);
      const recordAt = Math.round(0.717 * doc.fps) / doc.fps;
      api.playMotion(false);
      api.seekMotion(recordAt);
      await new Promise((r) => setTimeout(r, 400));

      const trackKeyframes = () => {
        const doc = api.motionInfo(path);
        return doc ? doc.keyframes : 0;
      };
      const keyframesBefore = trackKeyframes();
      const valueBefore = api.motionValueAt(path, target.id, recordAt);
      const recordOutcome = api.captureMotionFrame();
      await new Promise((r) => setTimeout(r, 300));
      const after = api.motionInfo(path);

      const recordedValue = api.motionValueAt(path, target.id, recordAt);

      return {
        ok: true,
        path,
        duration: before.duration,
        tracks: before.tracks,
        probe,
        liveA,
        liveB,
        keyframesBefore,
        keyframesAfter: after.keyframes,
        recordOutcome,
        valueBefore,
        pinnedCount: window.__sessionStore.getState().pinned.size,
        recordAt,
        recordedParameter: target.id,
        recordedExpected: target.maximum,
        recordedValue
      };
    })()`
  );

  if (!motionResult.ok) return fail(`motion flow failed — ${motionResult.error}`);
  console.log('motion flow:', JSON.stringify(motionResult, null, 2));

  // Seeking must actually change what the model shows.
  if (Math.abs(motionResult.liveA - motionResult.liveB) < 0.5) {
    return fail(
      `seeking the motion did not change the model ` +
        `(${motionResult.probe.id}: ${motionResult.liveA} vs ${motionResult.liveB})`
    );
  }
  // And the model must follow the curve, not some other value.
  if (Math.abs(motionResult.liveA - motionResult.probe.a) > 0.5) {
    return fail(
      `model does not match the curve at 25% ` +
        `(model ${motionResult.liveA}, curve ${motionResult.probe.a})`
    );
  }
  if (motionResult.keyframesAfter < motionResult.keyframesBefore) {
    return fail('recording removed keyframes');
  }
  if (motionResult.recordOutcome?.ok !== true) {
    return fail(`recording refused: ${motionResult.recordOutcome?.reason}`);
  }
  // The curve must have moved to the recorded pose. This is the assertion that
  // catches a recorder which runs without writing anything.
  if (Math.abs(motionResult.valueBefore - motionResult.recordedValue) < 0.5) {
    return fail(
      `recording did not change the curve at ${motionResult.recordAt}s ` +
        `(still ${motionResult.recordedValue})`
    );
  }
  if (Math.abs(motionResult.recordedValue - motionResult.recordedExpected) > 0.01) {
    return fail(
      `recorded keyframe holds ${motionResult.recordedValue}, ` +
        `expected ${motionResult.recordedExpected}`
    );
  }

  console.log('SMOKE PASS');
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((error) => fail(error instanceof Error ? error.stack : String(error)));
});
