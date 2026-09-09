/**
 * Captures the pose tab for one model given on the command line, for checking
 * how the panel behaves on a model the sample set does not cover.
 *
 * Usage: node scripts/shot-pose.js <path to .model3.json>
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, '.smoke');
const modelPath = process.argv[process.argv.length - 1];

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
  window.webContents.on('console-message', (...args) => {
    const d = args[0];
    console.error('[renderer]', d && typeof d === 'object' ? d.message : `${args[1]} ${args[2]}`);
  });
  window.setContentSize(1500, 900);

  const imported = await window.webContents.executeJavaScript(
    `(async () => {
      const probe = await window.api.probeImport(${JSON.stringify(modelPath)});
      if (!probe.candidates || probe.candidates.length === 0) return { ok:false, why:'no candidate' };
      const result = await window.api.importModel(probe.candidates[0]);
      window.__sessionStore.getState().beginLoading(result.workspace);
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 300));
        const st = window.__sessionStore.getState();
        if (st.status === 'ready') return { ok:true };
        if (st.status === 'error') return { ok:false, why: st.error };
      }
      return { ok:false, why:'timeout' };
    })()`
  );
  if (!imported.ok) throw new Error('load failed: ' + imported.why);
  await sleep(3000);

  const info = await window.webContents.executeJavaScript(
    `(() => {
      const i = window.__sessionStore.getState().info;
      return { parts: i.parts.length, drawables: i.drawables.length, hasParted: i.hasPartedDrawables };
    })()`
  );
  console.log('MODEL INFO', JSON.stringify(info));

  await window.webContents.executeJavaScript(
    `window.__editorUiStore.getState().setActivePanel('pose')`
  );
  await sleep(1200);
  fs.mkdirSync(outputDir, { recursive: true });
  let image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'pose-closed.png'), image.toPNG());

  // Open the first two groups so the mesh rows are visible in the shot.
  await window.webContents.executeJavaScript(
    `(() => {
      const buttons = [...document.querySelectorAll('.mesh-group__toggle')];
      buttons.slice(0,2).forEach(b => b.click());
      return buttons.length;
    })()`
  ).then((n) => console.log('GROUP BUTTONS', n));
  await sleep(1000);
  image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, 'pose-open.png'), image.toPNG());

  console.log('shots written');
  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error('FAIL', error);
    app.exit(1);
  })
);
