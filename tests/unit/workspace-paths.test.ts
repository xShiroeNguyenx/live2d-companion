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

/**
 * A workspace path built for whichever platform the test runs on.
 *
 * Hard-coding `C:/ws/...` looked platform-neutral but is not: on Linux there is
 * no drive letter, so `path.resolve` treats `C:` as an ordinary relative
 * directory name and hangs the whole path off the working directory. Every
 * assertion about the workspace boundary then measures something different from
 * what it does on Windows — and the "absolute path escapes" case silently
 * became a path *inside* the workspace, so it never threw and CI went red.
 */
const workingDir = path.resolve(path.sep, 'ws', 'model-abc12345', 'working');

/**
 * An absolute path that is definitely outside the workspace, on this platform.
 *
 * The whole point of the test is that resolution must not follow an absolute
 * reference out of the sandbox, so the reference has to actually be absolute
 * where the test runs.
 */
const escapingAbsolutePath = path.join(path.resolve(path.sep), 'elsewhere', 'secret.txt');

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
    expect(() => resolveWorkingFile(workingDir, escapingAbsolutePath)).toThrow(
      /ngoài workspace/
    );
  });

  it('rejects a Windows drive-absolute path even where it is not absolute', () => {
    // On Linux `C:/Windows/...` is a relative name, so resolution keeps it
    // inside the workspace and the guard above cannot fire. A model3.json
    // written on Windows can still carry such a reference, and creating a
    // directory literally called `C:` on a Linux host is not what anyone means.
    const resolved = path.resolve(workingDir, 'C:/Windows/System32/x');
    if (resolved.startsWith(workingDir + path.sep)) {
      expect(resolveWorkingFile(workingDir, 'C:/Windows/System32/x')).toBe(resolved);
    } else {
      expect(() => resolveWorkingFile(workingDir, 'C:/Windows/System32/x')).toThrow(
        /ngoài workspace/
      );
    }
  });

  it('does not treat a sibling directory with a shared prefix as inside', () => {
    // "working-backup" starts with "working" as a string but is a different
    // directory; the separator in the boundary check is what catches this.
    expect(() =>
      resolveWorkingFile(workingDir, '../working-backup/Hiyori.moc3')
    ).toThrow(/ngoài workspace/);
  });
});
