const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, '.smoke');

app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  require(path.join(projectRoot, 'out', 'main', 'index.js'));

  let window = null;
  const deadline = Date.now() + 30000;
  while (!window && Date.now() < deadline) {
    await sleep(250);
    window = BrowserWindow.getAllWindows()[0] ?? null;
  }
  if (!window) throw new Error('no window');
  if (window.webContents.isLoading()) {
    await new Promise((r) => window.webContents.once('did-finish-load', r));
  }
  window.setContentSize(1500, 900);

  const imported = await window.webContents.executeJavaScript(
    `(async () => {
      const samplePath = await window.api.sampleModelPath();
      const probe = await window.api.probeImport(samplePath);
      const result = await window.api.importModel(probe.candidates[0]);
      window.__sessionStore.getState().beginLoading(result.workspace);
      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        if (window.__sessionStore.getState().status === 'ready') return { ok: true };
      }
      return { ok: false };
    })()`
  );
  if (!imported.ok) throw new Error('model did not load');
  await sleep(3500);

  // Pose the model and capture an expression so the expression tab has content.
  await window.webContents.executeJavaScript(
    `(async () => {
      const api = window.__editorTestApi;
      const info = window.__sessionStore.getState().info;
      const angle = info.parameters.find((p) => p.id === 'ParamAngleX');
      const mouth = info.parameters.find((p) => p.id === 'ParamMouthOpenY');
      if (angle) api.setParameter(angle.index, 18);
      if (mouth) api.setParameter(mouth.index, 0.8);
      await new Promise((r) => setTimeout(r, 500));
      api.captureExpression();
      await new Promise((r) => setTimeout(r, 300));
      const name = api.expressionNames().at(-1);
      if (name) api.activateExpression(name);
      window.__editorUiStore?.getState?.().selectExpression?.(name ?? null);
    })()`
  );
  await sleep(1200);

  await window.webContents.executeJavaScript(
    `(async () => {
      const api = window.__editorTestApi;
      const info = window.__sessionStore.getState().info;
      api.addHitArea(info.drawables[0].id, 'Head');
      api.applyGroupSuggestions();
      await new Promise((r) => setTimeout(r, 300));
    })()`
  );
  await sleep(600);

  // Open a motion so the timeline has something to draw.
  await window.webContents.executeJavaScript(
    `(async () => {
      const api = window.__editorTestApi;
      const paths = api.motionPaths();
      if (paths.length > 0) {
        api.openMotion(paths[0]);
        api.seekMotion(api.motionInfo(paths[0]).duration * 0.35);
      }
      await new Promise((r) => setTimeout(r, 400));
    })()`
  );
  await sleep(800);

  for (const tab of ['motion', 'parameters', 'expressions', 'pose', 'config', 'export']) {
    await window.webContents.executeJavaScript(
      `window.__editorUiStore.getState().setActivePanel(${JSON.stringify(tab)})`
    );
    await sleep(900);
    const image = await window.webContents.capturePage();
    const file = path.join(outputDir, `tab-${tab}.png`);
    fs.writeFileSync(file, image.toPNG());
    console.log('saved', file);
  }

  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error('UI SHOTS FAIL:', error.stack ?? error);
    app.exit(1);
  })
);
