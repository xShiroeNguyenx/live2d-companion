/**
 * Drives the outfit tab end to end: detect the model's own switches, wear one,
 * save it, and report where the file landed.
 *
 * Usage: node scripts/shot-outfit.js <path to .model3.json>
 */
const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const modelPath = process.argv[process.argv.length - 1];

async function main() {
  require(path.join(root, 'out', 'main', 'index.js'));

  let win = null;
  const deadline = Date.now() + 30000;
  while (!win && Date.now() < deadline) {
    await sleep(250);
    win = BrowserWindow.getAllWindows()[0] ?? null;
  }
  if (!win) throw new Error('no window');
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r));
  }
  win.webContents.on('console-message', (...args) => {
    const details = args[0];
    const message =
      details && typeof details === 'object' ? details.message : `${args[1]} ${args[2]}`;
    if (!/DevTools/.test(message)) console.error('[renderer]', message);
  });
  win.setContentSize(1500, 900);

  const workspace = await win.webContents.executeJavaScript(`(async () => {
    const probe = await window.api.probeImport(${JSON.stringify(modelPath)});
    const result = await window.api.importModel(probe.candidates[0]);
    window.__sessionStore.getState().beginLoading(result.workspace);
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      if (window.__sessionStore.getState().status === 'ready') return result.workspace;
    }
    return null;
  })()`);
  if (!workspace) throw new Error('load failed');
  await sleep(3000);

  await win.webContents.executeJavaScript(
    `window.__editorUiStore.getState().setActivePanel('pose')`
  );
  await sleep(1200);
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('.subtab')][1].click()`);
  await sleep(1200);

  const rows = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.outfit-row__name')].map((e) => e.textContent)`
  );
  console.log('DETECTED:', JSON.stringify(rows));
  fs.writeFileSync(
    path.join(root, '.smoke', 'outfit-tab.png'),
    (await win.webContents.capturePage()).toPNG()
  );

  const target = rows.findIndex((row) => row.includes('睡衣'));
  console.log('WEARING index', target, rows[target]);
  const boxes = await win.webContents.executeJavaScript(`(() => {
    const boxes = [...document.querySelectorAll('.outfit-row input[type=checkbox]')];
    boxes[${target}].click();
    return boxes.length;
  })()`);
  console.log('CHECKBOXES', boxes);
  await sleep(1800);
  fs.writeFileSync(
    path.join(root, '.smoke', 'outfit-worn.png'),
    (await win.webContents.capturePage()).toPNG()
  );

  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('.outfit-found .button')]
      .find((element) => /Lưu thành bộ/.test(element.textContent));
    if (button) button.click();
    return Boolean(button);
  })()`);
  console.log('SAVE CLICKED', clicked);
  await sleep(3000);
  fs.writeFileSync(
    path.join(root, '.smoke', 'outfit-saved.png'),
    (await win.webContents.capturePage()).toPNG()
  );
  console.log('WORKSPACE', workspace.workspacePath);
  app.exit(0);
}

app.whenReady().then(() =>
  main().catch((error) => {
    console.error('FAIL', error);
    app.exit(1);
  })
);
