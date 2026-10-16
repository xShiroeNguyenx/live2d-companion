import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  WORKSPACES_SUBFOLDER,
  defaultWorkspaceRoot,
  describeFolder,
  directorySize,
  moveFolder,
  newRootProblem,
  readStorageSettings,
  rootForPickedFolder,
  writeStorageSettings
} from '../../src/main/services/workspaceStorage';
import { formatBytes } from '@shared/formatBytes';

/** Platform-neutral absolute paths, for the same reason as in workspace-paths.test.ts. */
const base = path.resolve(path.sep, 'data');

describe('defaultWorkspaceRoot', () => {
  it('keeps the old Documents folder when it already exists', () => {
    expect(defaultWorkspaceRoot('/docs/ws', '/appdata', true)).toBe('/docs/ws');
  });

  it('uses the app data folder on a fresh install', () => {
    expect(defaultWorkspaceRoot('/docs/ws', '/appdata', false)).toBe(
      path.join('/appdata', 'workspaces')
    );
  });
});

describe('newRootProblem', () => {
  const current = path.join(base, 'workspaces');

  it('accepts a folder elsewhere', () => {
    expect(newRootProblem(current, path.join(base, 'other'))).toBeNull();
  });

  it('accepts the parent of the current root', () => {
    expect(newRootProblem(current, base)).toBeNull();
  });

  it('rejects the current root itself', () => {
    expect(newRootProblem(current, current)).toMatch(/hiện tại/);
  });

  it('rejects a folder inside the current root', () => {
    expect(newRootProblem(current, path.join(current, 'nested'))).toMatch(/bên trong/);
  });

  it('does not mistake a sibling sharing a name prefix for a nested folder', () => {
    expect(newRootProblem(current, path.join(base, 'workspaces-2'))).toBeNull();
  });
});

describe('rootForPickedFolder', () => {
  const picked = path.join(base, 'pick');

  it('uses an empty folder as is', () => {
    expect(rootForPickedFolder(picked, [])).toBe(picked);
  });

  it('uses a folder that already holds workspaces as is', () => {
    expect(
      rootForPickedFolder(picked, [
        { name: 'notes.txt', isWorkspace: false },
        { name: 'hiyori-1234abcd', isWorkspace: true }
      ])
    ).toBe(picked);
  });

  it('adds a subfolder when the folder holds other things', () => {
    expect(rootForPickedFolder(picked, [{ name: 'Games', isWorkspace: false }])).toBe(
      path.join(picked, WORKSPACES_SUBFOLDER)
    );
  });
});

describe('on disk', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'l2d-storage-'));
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  async function makeWorkspace(dir: string): Promise<void> {
    await fs.mkdir(path.join(dir, 'working', 'textures'), { recursive: true });
    await fs.writeFile(path.join(dir, '.l2dproj.json'), '{}');
    await fs.writeFile(path.join(dir, 'working', 'model.moc3'), Buffer.alloc(1000));
    await fs.writeFile(path.join(dir, 'working', 'textures', 'a.png'), Buffer.alloc(500));
  }

  it('sums file sizes recursively', async () => {
    const ws = path.join(tmp, 'ws');
    await makeWorkspace(ws);
    expect(await directorySize(ws)).toBe(1000 + 500 + 2);
  });

  it('counts a missing folder as empty', async () => {
    expect(await directorySize(path.join(tmp, 'missing'))).toBe(0);
  });

  it('marks folders holding a manifest as workspaces', async () => {
    await makeWorkspace(path.join(tmp, 'ws'));
    await fs.mkdir(path.join(tmp, 'plain'));
    const entries = await describeFolder(tmp);
    expect(entries.find((entry) => entry.name === 'ws')?.isWorkspace).toBe(true);
    expect(entries.find((entry) => entry.name === 'plain')?.isWorkspace).toBe(false);
  });

  it('moves a workspace with all its files', async () => {
    const source = path.join(tmp, 'old', 'ws');
    const target = path.join(tmp, 'new', 'ws');
    await makeWorkspace(source);
    await moveFolder(source, target);
    expect(await directorySize(target)).toBe(1502);
    await expect(fs.access(source)).rejects.toThrow();
  });

  it('refuses to overwrite a workspace already at the target', async () => {
    const source = path.join(tmp, 'old', 'ws');
    const target = path.join(tmp, 'new', 'ws');
    await makeWorkspace(source);
    await makeWorkspace(target);
    await expect(moveFolder(source, target)).rejects.toThrow(/đã có/);
    // The source must survive a refused move.
    expect(await directorySize(source)).toBe(1502);
  });

  it('round-trips the chosen root and ignores a corrupt settings file', async () => {
    expect(await readStorageSettings(tmp)).toEqual({});
    await writeStorageSettings(tmp, { workspaceRoot: path.join(base, 'ws') });
    expect(await readStorageSettings(tmp)).toEqual({ workspaceRoot: path.join(base, 'ws') });
    await fs.writeFile(path.join(tmp, 'storage-settings.json'), '{not json');
    expect(await readStorageSettings(tmp)).toEqual({});
  });
});

describe('formatBytes', () => {
  it('formats with 1024 steps', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(9.21 * 1024 ** 3)).toBe('9.2 GB');
    expect(formatBytes(150 * 1024 ** 2)).toBe('150 MB');
  });

  it('shows a dash for nonsense input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});
