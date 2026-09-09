/**
 * Loads the Cubism Core and starts the framework once for the whole test run.
 *
 * The Core declares `var Live2DCubismCore` at script top level, which in a
 * browser lands on the global object — that is how the framework, which reads
 * the bare identifier while its modules evaluate, finds it. Under Node the
 * script has to be evaluated in the global scope explicitly, and then handed to
 * the framework's module scope, since ESM modules do not see `globalThis`
 * properties as bare identifiers unless they are real globals.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import { beforeAll } from 'vitest';

const source = readFileSync(resolve('vendor/live2dcubismcore/live2dcubismcore.js'), 'utf8');

// `runInThisContext` evaluates in the real global scope, so the script's
// top-level `var` becomes a genuine global — which `new Function` cannot do,
// because that creates a nested function scope.
runInThisContext(source, { filename: 'live2dcubismcore.js' });

const globals = globalThis as Record<string, unknown>;
if (globals.Live2DCubismCore === undefined) {
  throw new Error('Không nạp được Live2DCubismCore cho test.');
}

beforeAll(async () => {
  const { CubismFramework, LogLevel, Option } = await import(
    '@framework/live2dcubismframework'
  );
  if (!CubismFramework.isStarted()) {
    const option = new Option();
    option.logFunction = () => undefined;
    option.loggingLevel = LogLevel.LogLevel_Off;
    CubismFramework.startUp(option);
  }
  if (!CubismFramework.isInitialized()) CubismFramework.initialize();
});
