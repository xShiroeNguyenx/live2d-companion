/**
 * Copies the Cubism Core script into the renderer's public directory.
 *
 * The Core has to be loaded by index.html as a classic script (it assigns
 * `window.Live2DCubismCore`, which the framework reads at module scope), so it
 * must be a static asset rather than a bundle import. Only the one file is
 * copied — the rest of vendor/live2dcubismcore (types, licence, source map)
 * must not be served.
 *
 * Runs automatically before dev and build.
 */
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const publicDir = path.join(projectRoot, 'src', 'renderer', 'public');

const coreSource = path.join(
  projectRoot,
  'vendor',
  'live2dcubismcore',
  'live2dcubismcore.js'
);
const coreTarget = path.join(publicDir, 'live2dcubismcore.js');

if (!fs.existsSync(coreSource)) {
  console.error(`Cubism Core not found at ${coreSource}`);
  process.exit(1);
}

fs.mkdirSync(publicDir, { recursive: true });
fs.copyFileSync(coreSource, coreTarget);
console.log(`synced Cubism Core -> ${path.relative(projectRoot, coreTarget)}`);

// Since Cubism 5 R5 the renderer's GLSL lives in standalone .vert/.frag files
// that CubismShaderManager_WebGL fetches at runtime, so they have to be served
// as static assets too (see EditorRuntime's shader path).
const shaderSource = path.join(
  projectRoot,
  'vendor',
  'cubism-web-framework',
  'Shaders',
  'WebGL'
);
const shaderTarget = path.join(publicDir, 'shaders');

if (!fs.existsSync(shaderSource)) {
  console.error(`Framework shaders not found at ${shaderSource}`);
  process.exit(1);
}

fs.mkdirSync(shaderTarget, { recursive: true });
let copied = 0;
for (const entry of fs.readdirSync(shaderSource)) {
  if (!/\.(vert|frag)$/i.test(entry)) continue;
  fs.copyFileSync(path.join(shaderSource, entry), path.join(shaderTarget, entry));
  copied += 1;
}
console.log(`synced ${copied} shaders -> ${path.relative(projectRoot, shaderTarget)}`);
