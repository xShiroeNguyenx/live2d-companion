import { describe, expect, it } from 'vitest';
import { sanitiseFolderName } from '../../src/main/services/ExportService';

describe('sanitiseFolderName', () => {
  it('leaves an ordinary name alone', () => {
    expect(sanitiseFolderName('Hiyori')).toBe('Hiyori');
  });

  it('keeps spaces, dashes and non-ASCII letters', () => {
    // All legal on Windows; stripping them would rename the user's model behind
    // their back.
    expect(sanitiseFolderName('Hiyori - bản sửa')).toBe('Hiyori - bản sửa');
    expect(sanitiseFolderName('ヒヨリ 2048')).toBe('ヒヨリ 2048');
  });

  it('removes every character Windows rejects', () => {
    const backslash = String.fromCharCode(92);
    expect(sanitiseFolderName(`a<b>c:d"e/f${backslash}g|h?i*j`)).toBe('abcdefghij');
  });

  it('removes control characters', () => {
    const tab = String.fromCharCode(9);
    const nul = String.fromCharCode(0);
    expect(sanitiseFolderName(`Hi${tab}yo${nul}ri`)).toBe('Hiyori');
  });

  it('trims trailing dots and spaces that Windows would silently drop', () => {
    expect(sanitiseFolderName('Hiyori...')).toBe('Hiyori');
    expect(sanitiseFolderName('Hiyori   ')).toBe('Hiyori');
    expect(sanitiseFolderName('Hiyori . . ')).toBe('Hiyori');
  });

  it('keeps dots inside the name', () => {
    expect(sanitiseFolderName('Hiyori.v2')).toBe('Hiyori.v2');
  });

  it('falls back to a default when nothing usable remains', () => {
    expect(sanitiseFolderName('')).toBe('live2d-model');
    expect(sanitiseFolderName('///')).toBe('live2d-model');
    expect(sanitiseFolderName('   ')).toBe('live2d-model');
  });
});
