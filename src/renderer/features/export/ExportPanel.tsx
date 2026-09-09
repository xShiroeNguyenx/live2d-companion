import { useMemo, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import {
  cdi3Store,
  expressionsStore,
  model3Store,
  physics3Store,
  pose3Store
} from '../../document/stores/documentStores';
import { autosave } from '../../document/autosave';
import { splitIssues, validateModel } from './validate';

/**
 * Validates the model against its own moc, then copies it out as a plain Live2D
 * folder.
 *
 * Validation runs before export rather than on a timer because it is the moment
 * it matters: an id that does not exist in the moc is silently ignored by every
 * runtime, so without a check here the user would only discover the problem
 * when their expression does nothing in VTube Studio.
 */
export function ExportPanel() {
  const info = useSessionStore((state) => state.info);
  const workspace = useSessionStore((state) => state.workspace);
  const textureSizes = useSessionStore((state) => state.textureSizes);

  const model3 = model3Store((state) => state.data);
  const pose = pose3Store((state) => state.data);
  const posePath = pose3Store((state) => state.relativePath);
  const physics = physics3Store((state) => state.data);
  const physicsPath = physics3Store((state) => state.relativePath);
  const cdi3 = cdi3Store((state) => state.data);
  const cdi3Path = cdi3Store((state) => state.relativePath);
  const expressions = expressionsStore((state) => state.data);

  const [destination, setDestination] = useState<string | null>(null);
  const [folderName, setFolderName] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const issues = useMemo(() => {
    if (!info) return [];
    return validateModel({
      info,
      model3,
      // A document with no path was never loaded from disk, so it is not part
      // of this model and must not be validated as if it were.
      pose: posePath ? pose : null,
      physics: physicsPath ? physics : null,
      cdi3: cdi3Path ? cdi3 : null,
      expressions,
      textureSizes
    });
  }, [
    info,
    model3,
    pose,
    posePath,
    physics,
    physicsPath,
    cdi3,
    cdi3Path,
    expressions,
    textureSizes
  ]);

  const { errors, warnings } = useMemo(() => splitIssues(issues), [issues]);

  const handlePickDestination = async (): Promise<void> => {
    const folder = await window.api.pickExportFolder();
    if (folder) {
      setDestination(folder);
      setStatus(null);
    }
  };

  const handleExport = async (overwrite: boolean): Promise<void> => {
    if (!workspace || !destination) return;

    setBusy(true);
    setStatus(null);
    try {
      // Flush first: autosave is on a debounce, so a change made seconds ago
      // might not be on disk yet, and export copies from disk.
      await autosave.flush();

      const result = await window.api.exportModel({
        workspaceId: workspace.id,
        destinationDir: destination,
        folderName: folderName.trim() || workspace.displayName,
        overwrite
      });

      if (result.ok) {
        setStatus(`Đã xuất ${result.fileCount} file vào ${result.exportedPath}`);
      } else {
        setStatus(result.error ?? 'Xuất thất bại.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!info || !workspace) return <aside className="panel" />;

  return (
    <aside className="panel">
      <header className="panel__header">
        <h2>Xuất model</h2>
      </header>

      <section className="export__check">
        <h3>
          Kiểm tra{' '}
          {errors.length === 0 && warnings.length === 0 && (
            <span className="export__ok">không có vấn đề</span>
          )}
        </h3>

        {errors.length > 0 && (
          <div className="export__issues export__issues--error">
            <strong>{errors.length} lỗi</strong>
            <ul>
              {errors.slice(0, 12).map((issue, index) => (
                <li key={index}>
                  <span className="export__source">{issue.source}</span> {issue.message}
                  {issue.hint && <em> — {issue.hint}</em>}
                </li>
              ))}
            </ul>
            {errors.length > 12 && <p>…và {errors.length - 12} lỗi nữa.</p>}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="export__issues export__issues--warn">
            <strong>{warnings.length} cảnh báo</strong>
            <ul>
              {warnings.slice(0, 8).map((issue, index) => (
                <li key={index}>
                  <span className="export__source">{issue.source}</span> {issue.message}
                  {issue.hint && <em> — {issue.hint}</em>}
                </li>
              ))}
            </ul>
            {warnings.length > 8 && <p>…và {warnings.length - 8} cảnh báo nữa.</p>}
          </div>
        )}
      </section>

      <section className="export__destination">
        <h3>Nơi xuất</h3>
        <button
          type="button"
          className="button button--ghost"
          disabled={busy}
          onClick={() => void handlePickDestination()}
        >
          Chọn thư mục…
        </button>
        {destination && <p className="export__path">{destination}</p>}

        <label className="export__name">
          Tên thư mục
          <input
            className="input"
            value={folderName}
            placeholder={workspace.displayName}
            onChange={(event) => setFolderName(event.target.value)}
          />
        </label>

        <button
          type="button"
          className="button"
          disabled={busy || !destination || errors.length > 0}
          onClick={() => void handleExport(false)}
        >
          {busy ? 'Đang xuất…' : 'Xuất'}
        </button>

        {errors.length > 0 && (
          <p className="panel__warn">
            Sửa hết lỗi trước khi xuất — model có lỗi sẽ hoạt động sai trong runtime khác.
          </p>
        )}

        {status && <p className="export__status">{status}</p>}
      </section>

      <section className="export__notes">
        <h3>Dùng model đã xuất ở đâu</h3>
        <ul>
          <li>
            <strong>VTube Studio:</strong> copy cả thư mục vào
            <code>VTube Studio/Live2DModels/</code>. VTS tự sinh file
            <code>.vtube.json</code> lần đầu load.
          </li>
          <li>
            <strong>Companion app / web:</strong> trỏ tới file
            <code>{model3.FileReferences.Moc.replace(/\.moc3$/, '.model3.json')}</code>.
          </li>
          <li>
            File riêng của app (<code>.l2dproj.json</code>, <code>.backups</code>) không
            được copy — thư mục xuất là model Live2D chuẩn.
          </li>
        </ul>
      </section>
    </aside>
  );
}
