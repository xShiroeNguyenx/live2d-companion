import { useEffect, useState } from 'react';
import { formatBytes } from '@shared/formatBytes';
import type {
  ChangeStorageRootResult,
  StorageMoveProgress,
  StorageUsage
} from '@shared/types/workspace';

interface StorageSectionProps {
  usage: StorageUsage | null;
  workspaceCount: number;
  /** A model is open: switching without moving would pull its files out from under it. */
  hasOpenWorkspace: boolean;
  disabled: boolean;
  onBusyChange(busy: boolean): void;
  /** Called after the root changed, so the caller reloads its lists. */
  onChanged(result: ChangeStorageRootResult): void;
}

/**
 * Where workspaces are kept, how much room they take, and a way to move them.
 *
 * Every import is a full copy, so this folder grows with each model opened; on
 * a small system drive the user needs to see that and be able to move it.
 */
export function StorageSection({
  usage,
  workspaceCount,
  hasOpenWorkspace,
  disabled,
  onBusyChange,
  onChanged
}: StorageSectionProps) {
  const [candidate, setCandidate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<StorageMoveProgress | null>(null);

  useEffect(() => window.api.onStorageMoveProgress(setProgress), []);

  const pick = async (): Promise<void> => {
    setError(null);
    const picked = await window.api.pickStorageFolder();
    if (!picked) return;
    if (!picked.ok || !picked.rootDir) {
      setError(picked.error ?? 'Không dùng được thư mục này.');
      return;
    }
    setCandidate(picked.rootDir);
  };

  const apply = async (moveExisting: boolean): Promise<void> => {
    if (!candidate) return;
    onBusyChange(true);
    setError(null);
    try {
      const result = await window.api.changeStorageRoot(candidate, moveExisting);
      if (!result.ok) {
        setError(result.error ?? 'Không đổi được thư mục lưu trữ.');
        return;
      }
      setCandidate(null);
      onChanged(result);
    } finally {
      setProgress(null);
      onBusyChange(false);
    }
  };

  const moving = progress !== null && progress.total > 0;

  return (
    <section className="explorer__section explorer__storage">
      <div className="explorer__library-head">
        <h3>Lưu trữ</h3>
        <button
          type="button"
          className="explorer__icon-button"
          title="Mở thư mục lưu trữ"
          onClick={() => void window.api.revealStorageRoot()}
        >
          ↗
        </button>
      </div>

      <p className="explorer__storage-path" title={usage?.rootDir}>
        {usage?.rootDir ?? '…'}
      </p>
      <p className="explorer__hint">
        {usage
          ? `${workspaceCount} workspace · ${formatBytes(usage.totalBytes)}` +
            (usage.freeBytes !== null ? ` · ổ còn trống ${formatBytes(usage.freeBytes)}` : '')
          : 'Đang tính dung lượng…'}
      </p>

      {candidate === null ? (
        <button
          type="button"
          className="button button--ghost"
          disabled={disabled}
          onClick={() => void pick()}
        >
          Đổi thư mục lưu trữ…
        </button>
      ) : (
        <div className="explorer__storage-confirm">
          <p className="explorer__hint">
            Thư mục mới: <span className="explorer__storage-path">{candidate}</span>
          </p>
          {moving ? (
            <p className="explorer__hint">
              Đang chuyển {Math.min(progress.done + 1, progress.total)}/{progress.total}: {progress.current}
            </p>
          ) : (
            <>
              <button
                type="button"
                className="button"
                disabled={disabled || workspaceCount === 0}
                onClick={() => void apply(true)}
              >
                Chuyển {workspaceCount} workspace sang đó
                {usage ? ` (${formatBytes(usage.totalBytes)})` : ''}
              </button>
              <button
                type="button"
                className="button button--ghost"
                disabled={disabled || hasOpenWorkspace}
                title={
                  hasOpenWorkspace
                    ? 'Model đang mở nằm ở thư mục cũ; hãy chọn "Chuyển" để giữ nó.'
                    : undefined
                }
                onClick={() => void apply(false)}
              >
                Chỉ dùng thư mục mới (để nguyên dữ liệu cũ)
              </button>
              <button
                type="button"
                className="button button--ghost"
                disabled={disabled}
                onClick={() => setCandidate(null)}
              >
                Huỷ
              </button>
            </>
          )}
        </div>
      )}

      {error && <p className="explorer__message">{error}</p>}
    </section>
  );
}
