import type { ScannedModel } from './types/workspace';

/**
 * Case- and accent-insensitive match on a model's name and folder, for the
 * library search box. "hiy" finds Hiyori; "nhan vat" finds "Nhân vật/…".
 */
export function matchesLibraryFilter(
  model: Pick<ScannedModel, 'displayName' | 'relativeDir'>,
  filter: string
): boolean {
  const needle = foldForSearch(filter.trim());
  if (!needle) return true;
  return foldForSearch(`${model.displayName} ${model.relativeDir}`).includes(needle);
}

function foldForSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}
