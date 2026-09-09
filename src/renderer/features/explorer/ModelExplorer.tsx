import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import type { WorkspaceSummary } from '@shared/types/workspace';

/**
 * Home screen and importer.
 *
 * Import always copies into a workspace, so the folder the user points at is
 * only ever read. That is what lets the app promise it cannot damage a model.
 */
export function ModelExplorer() {
  const recent = useSessionStore((state) => state.recentWorkspaces);
  const setRecent = useSessionStore((state) => state.setRecentWorkspaces);
  const beginLoading = useSessionStore((state) => state.beginLoading);
  const workspace = useSessionStore((state) => state.workspace);
  const info = useSessionStore((state) => state.info);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<WorkspaceSummary[]> => {
    const list = await window.api.listWorkspaces();
    setRecent(list);
    return list;
  }, [setRecent]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const importFrom = useCallback(
    async (target: string): Promise<void> => {
      setBusy(true);
      setMessage(null);
      try {
        const probe = await window.api.probeImport(target);
        if (!probe.ok || probe.candidates.length === 0) {
          setMessage(probe.error ?? 'Không tìm thấy model trong thư mục này.');
          return;
        }

        const result = await window.api.importModel(probe.candidates[0]);
        if (!result.ok || !result.workspace) {
          setMessage(result.error ?? 'Import thất bại.');
          return;
        }

        if (result.missingFiles?.length) {
          setMessage(
            `Import xong nhưng thiếu ${result.missingFiles.length} file được tham chiếu: ` +
              result.missingFiles.slice(0, 3).join(', ')
          );
        }

        await refresh();
        beginLoading(result.workspace);
      } finally {
        setBusy(false);
      }
    },
    [beginLoading, refresh]
  );

  const handlePickFolder = async (): Promise<void> => {
    const folder = await window.api.pickModelFolder();
    if (folder) await importFrom(folder);
  };

  const handleLoadSample = async (): Promise<void> => {
    const samplePath = await window.api.sampleModelPath();
    await importFrom(samplePath);
  };

  const handleDrop = async (event: React.DragEvent): Promise<void> => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    const dropped = file ? window.api.getPathForFile(file) : '';
    if (dropped) await importFrom(dropped);
    else setMessage('Không lấy được đường dẫn từ thao tác kéo-thả.');
  };

  return (
    <aside
      className="panel panel--explorer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => void handleDrop(event)}
    >
      <header className="panel__header">
        <h2>Model</h2>
      </header>

      <div className="explorer__actions">
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => void handlePickFolder()}
        >
          Mở thư mục model…
        </button>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => void handleLoadSample()}
        >
          Dùng model mẫu (Hiyori)
        </button>
      </div>

      <p className="explorer__hint">
        Kéo-thả thư mục model vào đây. Bản gốc chỉ được đọc — app luôn làm việc trên bản
        copy riêng.
      </p>

      {message && <p className="explorer__message">{message}</p>}

      {recent.length > 0 && (
        <section className="explorer__section">
          <h3>Đã import</h3>
          <ul className="explorer__list">
            {recent.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`explorer__item${
                    workspace?.id === item.id ? ' explorer__item--active' : ''
                  }`}
                  onClick={() => beginLoading(item)}
                >
                  {item.displayName}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {info && (
        <section className="explorer__section">
          <h3>Thông tin moc</h3>
          <dl className="explorer__meta">
            <dt>Phiên bản moc3</dt>
            <dd>{describeMocVersion(info.mocVersion)}</dd>
            <dt>Tham số</dt>
            <dd>{info.parameters.length}</dd>
            <dt>Part</dt>
            <dd>{info.parts.length}</dd>
            <dt>Drawable</dt>
            <dd>{info.drawables.length}</dd>
            <dt>Canvas</dt>
            <dd>
              {info.canvas.widthPixel} × {info.canvas.heightPixel} px
            </dd>
            <dt>Mask</dt>
            <dd>{info.usesMasking ? 'Có' : 'Không'}</dd>
          </dl>
          {workspace && (
            <button
              type="button"
              className="button button--ghost"
              onClick={() => void window.api.revealInExplorer(workspace.id)}
            >
              Mở thư mục workspace
            </button>
          )}
        </section>
      )}
    </aside>
  );
}

/** Maps the moc3 header version byte to the Cubism release range it came from. */
function describeMocVersion(version: number): string {
  const names: Record<number, string> = {
    1: '3.0 – 3.2',
    2: '3.3',
    3: '4.0 – 4.1',
    4: '4.2',
    5: '5.0 – 5.2',
    6: '5.3+'
  };
  return names[version] ? `v${version} (Cubism ${names[version]})` : `v${version}`;
}
