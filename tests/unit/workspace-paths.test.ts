import { describe, expect, it } from 'vitest';
import path from 'node:path';

/**
 * The path-safety rules from WorkspaceService, exercised directly.
 *
 * These matter because relative paths in the editor come from model3.json,
 * which is untrusted input: a model could reference `../../../etc/passwd` and
 * autosave would happily follow it if resolution were naive.
 */
function resolveWorkingFile(workingDir: string, relativePath: string): string {
  const absolute = path.resolve(workingDir, relativePath);
  const boundary = workingDir.endsWith(path.sep) ? workingDir : workingDir + path.sep;
  if (absolute !== workingDir && !absolute.startsWith(boundary)) {
    throw new Error(`Đường dẫn nằm ngoài workspace: ${relativePath}`);
  }
  return absolute;
}

const workingDir = path.resolve('C:/ws/model-abc12345/working');

describe('resolveWorkingFile', () => {
  it('resolves a plain file reference', () => {
    expect(resolveWorkingFile(workingDir, 'Hiyori.model3.json')).toBe(
      path.join(workingDir, 'Hiyori.model3.json')
    );
  });

  it('resolves a nested reference the way model3.json expresses it', () => {
    expect(resolveWorkingFile(workingDir, 'motions/Hiyori_m01.motion3.json')).toBe(
      path.join(workingDir, 'motions', 'Hiyori_m01.motion3.json')
    );
  });

  it('rejects traversal out of the workspace', () => {
    expect(() => resolveWorkingFile(workingDir, '../original/Hiyori.moc3')).toThrow(
      /ngoài workspace/
    );
    expect(() => resolveWorkingFile(workingDir, '../../../Windows/System32/x')).toThrow(
      /ngoài workspace/
    );
  });

  it('rejects an absolute path that escapes the workspace', () => {
    expect(() => resolveWorkingFile(workingDir, 'C:/Windows/System32/x')).toThrow(
      /ngoài workspace/
    );
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    // "working-backup" starts with "working" as a string but is a different
    // directory; the separator in the boundary check is what catches this.
    expect(() =>
      resolveWorkingFile(workingDir, '../working-backup/Hiyori.moc3')
    ).toThrow(/ngoài workspace/);
  });
});
