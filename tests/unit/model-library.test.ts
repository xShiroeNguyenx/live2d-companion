import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  scanModelLibrary,
  thumbnailTextureFor,
  workspaceIdFor
} from '../../src/main/services/modelLibrary';
import { matchesLibraryFilter } from '@shared/libraryFilter';

/**
 * Scanning a folder of many models. Built on a real temporary folder because
 * the behaviour under test is the directory walk itself.
 */
let root: string;

async function touch(relative: string): Promise<void> {
  const full = path.join(root, ...relative.split('/'));
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, '{}');
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'l2d-library-'));
  await touch('Model10/Model10.model3.json');
  await touch('Model2/Model2.model3.json');
  await touch('Alice/runtime/alice.model3.json');
  await touch('Pack/Bob/Bob.model3.json');
  await touch('Pack/Bob/Bob.physics3.json');
  await touch('top.model3.json');
  await touch('.hidden/Secret.model3.json');
  await touch('node_modules/pkg/Junk.model3.json');
  await touch('a/b/c/d/e/f/TooDeep.model3.json');
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('scanModelLibrary', () => {
  it('finds models at the root and in nested folders, skipping hidden and vendor dirs', async () => {
    const { models, truncated } = await scanModelLibrary(root);
    expect(truncated).toBe(false);
    expect(models.map((model) => model.displayName)).toEqual([
      'top',
      'alice',
      'Model2',
      'Model10',
      'Bob'
    ]);
  });

  it('reports each model folder relative to the library with forward slashes', async () => {
    const { models } = await scanModelLibrary(root);
    const bob = models.find((model) => model.displayName === 'Bob');
    expect(bob?.relativeDir).toBe('Pack/Bob');
    expect(bob?.modelSettingPath).toBe(path.join(root, 'Pack', 'Bob', 'Bob.model3.json'));
    expect(models.find((model) => model.displayName === 'top')?.relativeDir).toBe('');
  });

  it('respects the depth limit', async () => {
    const shallow = await scanModelLibrary(root, 1);
    expect(shallow.models.map((model) => model.displayName)).not.toContain('alice');
    const deep = await scanModelLibrary(root, 6);
    expect(deep.models.map((model) => model.displayName)).toContain('TooDeep');
  });

  it('stops and flags truncation at the model cap', async () => {
    const { models, truncated } = await scanModelLibrary(root, 5, 2);
    expect(models).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it('returns nothing rather than throwing for a missing folder', async () => {
    const { models } = await scanModelLibrary(path.join(root, 'does-not-exist'));
    expect(models).toEqual([]);
  });
});

describe('workspaceIdFor', () => {
  it('is stable for the same model and differs between folders', () => {
    const a = path.join(root, 'Pack', 'Bob', 'Bob.model3.json');
    const b = path.join(root, 'Other', 'Bob', 'Bob.model3.json');
    expect(workspaceIdFor(a)).toBe(workspaceIdFor(a));
    expect(workspaceIdFor(a)).not.toBe(workspaceIdFor(b));
    expect(workspaceIdFor(a)).toMatch(/^bob-[0-9a-f]{8}$/);
  });
});

describe('matchesLibraryFilter', () => {
  const model = { displayName: 'Hiyori', relativeDir: 'Nhân vật/Đồng phục' };

  it('matches everything on an empty filter', () => {
    expect(matchesLibraryFilter(model, '  ')).toBe(true);
  });

  it('ignores case and Vietnamese accents, and searches the folder too', () => {
    expect(matchesLibraryFilter(model, 'hiy')).toBe(true);
    expect(matchesLibraryFilter(model, 'nhan vat')).toBe(true);
    expect(matchesLibraryFilter(model, 'dong phuc')).toBe(true);
    expect(matchesLibraryFilter(model, 'mao')).toBe(false);
  });
});

describe('thumbnailTextureFor', () => {
  async function writeSetting(name: string, setting: unknown): Promise<string> {
    const full = path.join(root, 'thumbs', name, 'model.model3.json');
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, JSON.stringify(setting));
    return full;
  }

  it('resolves the first texture against the model folder', async () => {
    const setting = await writeSetting('ok', {
      FileReferences: { Textures: ['model.4096/texture_00.png', 'model.4096/texture_01.png'] }
    });
    expect(await thumbnailTextureFor(setting)).toBe(
      path.join(path.dirname(setting), 'model.4096', 'texture_00.png')
    );
  });

  it('returns null when there is no texture or the file is not JSON', async () => {
    expect(await thumbnailTextureFor(await writeSetting('none', { FileReferences: {} }))).toBeNull();
    expect(
      await thumbnailTextureFor(await writeSetting('empty', { FileReferences: { Textures: [] } }))
    ).toBeNull();
    expect(await thumbnailTextureFor(path.join(root, 'Model2', 'missing.model3.json'))).toBeNull();
  });

  it('refuses textures outside the model folder', async () => {
    const up = await writeSetting('up', { FileReferences: { Textures: ['../../secret.png'] } });
    expect(await thumbnailTextureFor(up)).toBeNull();
    const absolute = await writeSetting('abs', {
      FileReferences: { Textures: [path.join(os.tmpdir(), 'elsewhere.png')] }
    });
    expect(await thumbnailTextureFor(absolute)).toBeNull();
  });
});
