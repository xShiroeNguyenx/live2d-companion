import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import { formatBytes } from '@shared/formatBytes';
import type {
  ChangeStorageRootResult,
  LibraryModel,
  LibraryScan,
  StorageUsage,
  WorkspaceSummary
} from '@shared/types/workspace';
import { LibrarySection } from './LibrarySection';
import { StorageSection } from './StorageSection';

/** The last library folder, so reopening the app shows the same list. */
const LIBRARY_ROOT_KEY = 'l2d.libraryRoot';

function readLibraryRoot(): string | null {
  try {
    return localStorage.getItem(LIBRARY_ROOT_KEY);
  } catch {
    return null;
  }
}

function writeLibraryRoot(rootDir: string | null): void {
  try {
    if (rootDir) localStorage.setItem(LIBRARY_ROOT_KEY, rootDir);
    else localStorage.removeItem(LIBRARY_ROOT_KEY);
  } catch {
    // Remembering the folder is a convenience; the library still works without it.
  }
}

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
  const [library, setLibrary] = useState<LibraryScan | null>(null);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  // Sizes walk every file, so they load after the list instead of holding it up.
  const refreshUsage = useCallback(async (): Promise<void> => {
    setUsage(await window.api.storageUsage());
  }, []);

  const refresh = useCallback(async (): Promise<WorkspaceSummary[]> => {
    const list = await window.api.listWorkspaces();
    setRecent(list);
    void refreshUsage();
    return list;
  }, [setRecent, refreshUsage]);

  const deleteWorkspace = useCallback(
    async (item: WorkspaceSummary): Promise<void> => {
      const bytes = usage?.workspaceBytes[item.id];
      const size = bytes !== undefined ? ` (${formatBytes(bytes)})` : '';
      const confirmed = window.confirm(
        `Xoá workspace "${item.displayName}"${size}?

` +
          'Mọi chỉnh sửa trong workspace này sẽ mất và không khôi phục được. ' +
          'Thư mục model gốc không bị đụng tới.'
      );
      if (!confirmed) return;
      setBusy(true);
      setMessage(null);
      try {
        const result = await window.api.deleteWorkspace(item.id);
        if (!result.ok) {
          setMessage(`Không xoá được "${item.displayName}": ${result.error ?? 'lỗi không rõ'}`);
          return;
        }
        setLibrary(
          (current) =>
            current && {
              ...current,
              models: current.models.map((entry) =>
                entry.workspace?.id === item.id ? { ...entry, workspace: undefined } : entry
              )
            }
        );
        await refresh();
      } finally {
        setBusy(false);
      }
    },
    [refresh, usage]
  );


  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadLibrary = useCallback(async (rootDir: string, quiet = false): Promise<void> => {
    setBusy(true);
    if (!quiet) setMessage(null);
    try {
      const scan = await window.api.scanLibrary(rootDir);
      if (!scan.ok) {
        // A remembered folder that has since moved should not nag on every start.
        if (!quiet) setMessage(scan.error ?? 'Không đọc được thư mục.');
        writeLibraryRoot(null);
        setLibrary(null);
        return;
      }
      if (scan.models.length === 0) {
        if (!quiet) setMessage('Không tìm thấy file .model3.json nào trong thư mục này.');
        return;
      }
      setLibrary(scan);
      writeLibraryRoot(scan.rootDir);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const remembered = readLibraryRoot();
    if (remembered) void loadLibrary(remembered, true);
  }, [loadLibrary]);

  const handleStorageChanged = useCallback(
    async (result: ChangeStorageRootResult): Promise<void> => {
      await refresh();
      // Which library models count as imported depends on the root, so rescan.
      if (library) await loadLibrary(library.rootDir, true);
      setMessage(
        result.failed.length === 0
          ? `Đã chuyển sang ${result.rootDir}` +
              (result.moved > 0 ? ` (${result.moved} workspace).` : '.')
          : `Đã chuyển ${result.moved} workspace. ${result.failed.length} workspace vẫn ở thư mục cũ: ` +
              result.failed
                .slice(0, 3)
                .map((failure) => `${failure.id} (${failure.error})`)
                .join(', ')
      );
    },
    [library, loadLibrary, refresh]
  );

  const openLibraryModel = useCallback(
    async (model: LibraryModel): Promise<void> => {
      if (model.workspace && model.workspace.id === workspace?.id) return;
      setBusy(true);
      setOpeningPath(model.modelSettingPath);
      setMessage(null);
      try {
        const result = await window.api.openOrImport(model.modelSettingPath);
        if (!result.ok || !result.workspace) {
          setMessage(`${model.displayName}: ${result.error ?? 'Import thất bại.'}`);
          return;
        }
        if (result.missingFiles?.length) {
          setMessage(
            `Import xong nhưng thiếu ${result.missingFiles.length} file được tham chiếu: ` +
              result.missingFiles.slice(0, 3).join(', ')
          );
        }
        const opened = result.workspace;
        // Mark the entry imported without rescanning the whole folder.
        setLibrary((current) =>
          current && {
            ...current,
            models: current.models.map((entry) =>
              entry.modelSettingPath === model.modelSettingPath
                ? { ...entry, workspace: opened }
                : entry
            )
          }
        );
        await refresh();
        beginLoading(opened);
      } finally {
        setOpeningPath(null);
        setBusy(false);
      }
    },
    [beginLoading, refresh, workspace?.id]
  );

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
        if (probe.candidates.length > 1) {
          // Several models: list them all instead of silently importing the first.
          setBusy(false);
          await loadLibrary(target);
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
    [beginLoading, loadLibrary, refresh]
  );

  const handlePickLibrary = async (): Promise<void> => {
    const folder = await window.api.pickModelFolder();
    if (folder) await loadLibrary(folder);
  };

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
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => void handlePickLibrary()}
        >
          Mở thư mục nhiều model…
        </button>
      </div>

      <p className="explorer__hint">
        Kéo-thả thư mục model vào đây. Bản gốc chỉ được đọc — app luôn làm việc trên bản
        copy riêng.
      </p>

      {message && <p className="explorer__message">{message}</p>}

      {library && (
        <LibrarySection
          library={library}
          activeWorkspaceId={workspace?.id ?? null}
          openingPath={openingPath}
          disabled={busy}
          onOpen={(model) => void openLibraryModel(model)}
          onRescan={() => void loadLibrary(library.rootDir)}
          onClose={() => {
            setLibrary(null);
            writeLibraryRoot(null);
          }}
        />
      )}

      {recent.length > 0 && (
        <section className="explorer__section explorer__recent">
          <h3>Đã import</h3>
          <ul className="explorer__list">
            {recent.map((item) => {
              const active = workspace?.id === item.id;
              const bytes = usage?.workspaceBytes[item.id];
              return (
                <li key={item.id} className="explorer__recent-row">
                  <button
                    type="button"
                    className={`explorer__item${active ? ' explorer__item--active' : ''}`}
                    onClick={() => beginLoading(item)}
                  >
                    <span className="explorer__recent-name">{item.displayName}</span>
                    {bytes !== undefined && (
                      <span className="explorer__recent-size">{formatBytes(bytes)}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="explorer__icon-button"
                    title={active ? 'Không thể xoá model đang mở' : 'Xoá workspace này'}
                    disabled={busy || active}
                    onClick={() => void deleteWorkspace(item)}
                  >
                    🗑
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <StorageSection
        usage={usage}
        workspaceCount={recent.length}
        hasOpenWorkspace={workspace !== null}
        disabled={busy}
        onBusyChange={setBusy}
        onChanged={(result) => void handleStorageChanged(result)}
      />

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
