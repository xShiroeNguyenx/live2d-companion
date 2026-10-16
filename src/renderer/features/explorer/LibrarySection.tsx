import { useEffect, useMemo, useRef, useState } from 'react';
import { matchesLibraryFilter } from '@shared/libraryFilter';
import type { LibraryModel, LibraryScan } from '@shared/types/workspace';

interface LibrarySectionProps {
  library: LibraryScan;
  /** Workspace currently open in the editor, to highlight its entry. */
  activeWorkspaceId: string | null;
  /** Model being opened right now, shown as busy. */
  openingPath: string | null;
  disabled: boolean;
  onOpen(model: LibraryModel): void;
  onRescan(): void;
  onClose(): void;
}

/**
 * Every model in a folder of many models, one click to open.
 *
 * Nothing is copied while listing; a model is imported into its own workspace
 * the first time it is clicked, and reused after that.
 */
export function LibrarySection({
  library,
  activeWorkspaceId,
  openingPath,
  disabled,
  onOpen,
  onRescan,
  onClose
}: LibrarySectionProps) {
  const [filter, setFilter] = useState('');
  const visible = useMemo(
    () => library.models.filter((model) => matchesLibraryFilter(model, filter)),
    [library.models, filter]
  );
  const folderName = library.rootDir.split(/[\\/]/).filter(Boolean).pop() ?? library.rootDir;

  return (
    <section className="explorer__section explorer__library">
      <div className="explorer__library-head">
        <h3 title={library.rootDir}>
          Thư viện · {folderName} ({library.models.length})
        </h3>
        <button
          type="button"
          className="explorer__icon-button"
          title="Quét lại thư mục"
          disabled={disabled}
          onClick={onRescan}
        >
          ↻
        </button>
        <button
          type="button"
          className="explorer__icon-button"
          title="Đóng thư viện"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {library.truncated && (
        <p className="explorer__hint">
          Thư mục có quá nhiều model, chỉ hiện {library.models.length} model đầu tiên. Hãy chọn
          thư mục con cụ thể hơn.
        </p>
      )}

      {library.models.length > 8 && (
        <input
          type="search"
          className="input"
          placeholder="Tìm model…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}

      <ul className="explorer__list explorer__library-list">
        {visible.map((model) => {
          const active =
            activeWorkspaceId !== null && model.workspace?.id === activeWorkspaceId;
          const opening = openingPath === model.modelSettingPath;
          return (
            <li key={model.modelSettingPath}>
              <button
                type="button"
                className={`explorer__item explorer__library-item${
                  active ? ' explorer__item--active' : ''
                }`}
                title={model.modelSettingPath}
                disabled={disabled && !active}
                onClick={() => onOpen(model)}
              >
                <LibraryThumb modelSettingPath={model.modelSettingPath} />
                <span className="explorer__library-text">
                  <span className="explorer__library-name">
                    {model.displayName}
                    {opening && <span className="explorer__library-tag">đang mở…</span>}
                    {!opening && model.workspace && (
                      <span className="explorer__library-tag">đã import</span>
                    )}
                  </span>
                  {model.relativeDir && (
                    <span className="explorer__library-dir">{model.relativeDir}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {visible.length === 0 && (
          <li className="explorer__hint">Không có model nào khớp “{filter}”.</li>
        )}
      </ul>
    </section>
  );
}

/**
 * Previews already fetched, kept across rescans and re-renders. A promise is
 * stored so rows that mount together share one request.
 */
const thumbnailCache = new Map<string, Promise<string | null>>();

function loadThumbnail(modelSettingPath: string): Promise<string | null> {
  let pending = thumbnailCache.get(modelSettingPath);
  if (!pending) {
    pending = window.api.libraryThumbnail(modelSettingPath).catch(() => null);
    thumbnailCache.set(modelSettingPath, pending);
  }
  return pending;
}

/**
 * The model's first texture, fetched only once its row scrolls into view so
 * opening a library of hundreds does not decode hundreds of atlases up front.
 */
function LibraryThumb({ modelSettingPath }: { modelSettingPath: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      void loadThumbnail(modelSettingPath).then((url) => {
        if (!cancelled) setSrc(url);
      });
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [modelSettingPath]);

  return (
    <span ref={ref} className="explorer__library-thumb" aria-hidden="true">
      {src && <img src={src} alt="" draggable={false} />}
    </span>
  );
}
