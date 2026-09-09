import { useMemo, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import { cdi3Store, model3Store } from '../../document/stores/documentStores';
import { cancelDrawablePick, requestDrawablePick } from '../../document/canvasPick';
import { suggestGroupIds } from './configOps';

type Section = 'hitAreas' | 'groups' | 'names';

/**
 * Configures how the model responds to the outside world: tap targets, which
 * parameters blink and lip-sync, and the display names shown everywhere.
 *
 * None of this changes how the model looks — it is what makes a model usable in
 * a companion app or VTube Studio, which is exactly the setup work a
 * non-technical user has no other way to do.
 */
export function ConfigPanel() {
  const info = useSessionStore((state) => state.info);
  const model3 = model3Store((state) => state.data);
  const editModel3 = model3Store((state) => state.edit);
  const cdi3 = cdi3Store((state) => state.data);
  const cdi3Path = cdi3Store((state) => state.relativePath);
  const editCdi3 = cdi3Store((state) => state.edit);
  const loadCdi3 = cdi3Store((state) => state.load);
  const baseDir = useSessionStore((state) => state.baseDir);

  const canvasMode = useEditorUiStore((state) => state.canvasMode);
  const setCanvasMode = useEditorUiStore((state) => state.setCanvasMode);
  const lastHitTest = useEditorUiStore((state) => state.lastHitTest);

  const [section, setSection] = useState<Section>('hitAreas');
  const [nameFilter, setNameFilter] = useState('');

  const hitAreas = model3.HitAreas ?? [];
  const groups = model3.Groups ?? [];

  const eyeBlinkGroup = groups.find((group) => group.Name === 'EyeBlink');
  const lipSyncGroup = groups.find((group) => group.Name === 'LipSync');

  const suggestions = useMemo(
    () => (info ? suggestGroupIds(info) : { eyeBlink: [], lipSync: [] }),
    [info]
  );

  const drawableName = (id: string): string =>
    info?.drawables.find((drawable) => drawable.id === id) ? id : `${id} (không có trong moc)`;

  /** Starts a pick and adds the clicked mesh as a new hit area. */
  const handleAddHitArea = (): void => {
    setCanvasMode('pickDrawable');
    requestDrawablePick((drawableId) => {
      setCanvasMode('none');
      if (hitAreas.some((area) => area.Id === drawableId)) {
        window.alert('Mesh này đã được dùng cho một vùng chạm khác.');
        return;
      }
      // A sensible default name; the user renames it in the table below.
      const name = `Area${hitAreas.length + 1}`;
      editModel3(`Thêm vùng chạm "${name}"`, (draft) => {
        const areas = draft.HitAreas ?? [];
        areas.push({ Id: drawableId, Name: name });
        draft.HitAreas = areas;
      });
    });
  };

  const handleCancelPick = (): void => {
    cancelDrawablePick();
    setCanvasMode('none');
  };

  const handleRenameHitArea = (index: number, name: string): void => {
    editModel3(
      'Đổi tên vùng chạm',
      (draft) => {
        const area = draft.HitAreas?.[index];
        if (area) area.Name = name;
      },
      `hitArea:${index}:name`
    );
  };

  const handleRemoveHitArea = (index: number): void => {
    editModel3('Xoá vùng chạm', (draft) => {
      draft.HitAreas?.splice(index, 1);
    });
  };

  /** Replaces one of the well-known groups with a new id list. */
  const setGroupIds = (name: 'EyeBlink' | 'LipSync', ids: string[]): void => {
    editModel3(`Cập nhật nhóm ${name}`, (draft) => {
      const list = draft.Groups ?? [];
      const existing = list.find((group) => group.Name === name);
      if (ids.length === 0) {
        draft.Groups = list.filter((group) => group.Name !== name);
        return;
      }
      if (existing) existing.Ids = ids;
      else list.push({ Target: 'Parameter', Name: name, Ids: ids });
      draft.Groups = list;
    });
  };

  const toggleGroupId = (name: 'EyeBlink' | 'LipSync', id: string): void => {
    const current =
      (name === 'EyeBlink' ? eyeBlinkGroup?.Ids : lipSyncGroup?.Ids) ?? [];
    setGroupIds(
      name,
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  };

  /** Creates cdi3.json for a model that has none, so names can be edited. */
  const ensureCdi3 = (): void => {
    if (cdi3Path) return;
    const fileName = 'display.cdi3.json';
    loadCdi3(
      { Version: 3, Parameters: [], ParameterGroups: [], Parts: [] },
      `${baseDir}${fileName}`
    );
    editModel3('Thêm cdi3.json vào model3', (draft) => {
      draft.FileReferences.DisplayInfo = fileName;
    });
  };

  const setDisplayName = (
    kind: 'Parameters' | 'Parts',
    id: string,
    name: string
  ): void => {
    ensureCdi3();
    editCdi3(
      'Đổi tên hiển thị',
      (draft) => {
        const list = draft[kind];
        const entry = list.find((item) => item.Id === id);
        if (entry) entry.Name = name;
        else if (kind === 'Parameters') {
          draft.Parameters.push({ Id: id, GroupId: '', Name: name });
        } else {
          draft.Parts.push({ Id: id, Name: name });
        }
      },
      `cdi3:${kind}:${id}`
    );
  };

  const nameRows = useMemo(() => {
    if (!info) return [];
    const needle = nameFilter.trim().toLowerCase();
    const paramNames = new Map(cdi3.Parameters.map((entry) => [entry.Id, entry.Name]));
    const partNames = new Map(cdi3.Parts.map((entry) => [entry.Id, entry.Name]));

    return [
      ...info.parameters.map((parameter) => ({
        kind: 'Parameters' as const,
        id: parameter.id,
        name: paramNames.get(parameter.id) ?? ''
      })),
      ...info.parts.map((part) => ({
        kind: 'Parts' as const,
        id: part.id,
        name: partNames.get(part.id) ?? ''
      }))
    ].filter(
      (row) =>
        needle === '' ||
        row.id.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle)
    );
  }, [info, cdi3, nameFilter]);

  if (!info) return <aside className="panel" />;

  return (
    <aside className="panel">
      <nav className="subtabs">
        <button
          type="button"
          className={`subtab${section === 'hitAreas' ? ' subtab--active' : ''}`}
          onClick={() => setSection('hitAreas')}
        >
          Vùng chạm
        </button>
        <button
          type="button"
          className={`subtab${section === 'groups' ? ' subtab--active' : ''}`}
          onClick={() => setSection('groups')}
        >
          Nháy mắt / Khẩu hình
        </button>
        <button
          type="button"
          className={`subtab${section === 'names' ? ' subtab--active' : ''}`}
          onClick={() => setSection('names')}
        >
          Tên hiển thị
        </button>
      </nav>

      {section === 'hitAreas' && (
        <>
          <p className="panel__hint">
            Vùng chạm là nơi người dùng bấm vào model để kích hoạt phản ứng. Không vẽ mới
            được — phải chọn một mesh có sẵn, vì hình dạng đã nằm trong file .moc3.
          </p>

          <div className="config__actions">
            {canvasMode === 'pickDrawable' ? (
              <button type="button" className="button button--ghost" onClick={handleCancelPick}>
                Huỷ chọn
              </button>
            ) : (
              <button type="button" className="button" onClick={handleAddHitArea}>
                Thêm bằng cách bấm lên model
              </button>
            )}
            <button
              type="button"
              className={`button button--ghost${
                canvasMode === 'testHitAreas' ? ' button--on' : ''
              }`}
              disabled={hitAreas.length === 0}
              onClick={() =>
                setCanvasMode(canvasMode === 'testHitAreas' ? 'none' : 'testHitAreas')
              }
            >
              {canvasMode === 'testHitAreas' ? 'Thoát thử' : 'Thử vùng chạm'}
            </button>
          </div>

          {canvasMode === 'testHitAreas' && (
            <p className="config__result">
              {lastHitTest
                ? `Bấm trúng: ${lastHitTest.areaName}`
                : 'Bấm lên model để xem vùng nào phản hồi. Phép thử dùng hộp bao quanh mesh, giống hệt runtime.'}
            </p>
          )}

          <div className="panel__scroll">
            {hitAreas.length === 0 ? (
              <p className="panel__empty">Chưa có vùng chạm nào.</p>
            ) : (
              <table className="config-table">
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th>Mesh</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {hitAreas.map((area, index) => (
                    <tr key={`${area.Id}-${index}`}>
                      <td>
                        <input
                          value={area.Name}
                          onChange={(event) => handleRenameHitArea(index, event.target.value)}
                        />
                      </td>
                      <td className="config-table__id" title={area.Id}>
                        {drawableName(area.Id)}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="expr__action expr__action--danger"
                          onClick={() => handleRemoveHitArea(index)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {section === 'groups' && (
        <>
          <p className="panel__hint">
            Runtime dùng hai nhóm này để tự nháy mắt và mấp máy môi theo tiếng. Chọn đúng
            tham số thì companion app và VTube Studio hoạt động ngay, không cần cấu hình
            thêm.
          </p>

          <div className="panel__scroll">
            <GroupPicker
              title="EyeBlink — tham số nhắm/mở mắt"
              selected={eyeBlinkGroup?.Ids ?? []}
              suggestions={suggestions.eyeBlink}
              parameters={info.parameters}
              onToggle={(id) => toggleGroupId('EyeBlink', id)}
              onApplySuggestion={() => setGroupIds('EyeBlink', suggestions.eyeBlink)}
            />
            <GroupPicker
              title="LipSync — tham số mở miệng"
              selected={lipSyncGroup?.Ids ?? []}
              suggestions={suggestions.lipSync}
              parameters={info.parameters}
              onToggle={(id) => toggleGroupId('LipSync', id)}
              onApplySuggestion={() => setGroupIds('LipSync', suggestions.lipSync)}
            />
          </div>
        </>
      )}

      {section === 'names' && (
        <>
          <p className="panel__hint">
            Tên hiển thị (cdi3.json) chỉ đổi nhãn trong app và trong Cubism Viewer — id
            thật trong .moc3 không đổi, nên model vẫn tương thích mọi runtime.
          </p>
          {cdi3Path === null && (
            <p className="panel__warn">
              Model chưa có cdi3.json. File sẽ được tạo khi bạn đặt tên đầu tiên.
            </p>
          )}
          <input
            className="input"
            type="search"
            placeholder="Tìm theo id hoặc tên…"
            value={nameFilter}
            onChange={(event) => setNameFilter(event.target.value)}
          />
          <div className="panel__scroll">
            <table className="config-table">
              <thead>
                <tr>
                  <th>Id</th>
                  <th>Tên hiển thị</th>
                </tr>
              </thead>
              <tbody>
                {nameRows.map((row) => (
                  <tr key={`${row.kind}-${row.id}`}>
                    <td className="config-table__id" title={row.id}>
                      {row.id}
                    </td>
                    <td>
                      <input
                        value={row.name}
                        placeholder={row.id}
                        onChange={(event) =>
                          setDisplayName(row.kind, row.id, event.target.value)
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </aside>
  );
}

interface GroupPickerProps {
  title: string;
  selected: string[];
  suggestions: string[];
  parameters: Array<{ id: string; name: string }>;
  onToggle(id: string): void;
  onApplySuggestion(): void;
}

function GroupPicker({
  title,
  selected,
  suggestions,
  parameters,
  onToggle,
  onApplySuggestion
}: GroupPickerProps) {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();

  // Selected entries stay visible regardless of the filter, so a user cannot
  // lose track of what is in the group while searching.
  const visible = parameters.filter(
    (parameter) =>
      selected.includes(parameter.id) ||
      needle === '' ||
      parameter.id.toLowerCase().includes(needle) ||
      parameter.name.toLowerCase().includes(needle)
  );

  const suggestionMatches =
    suggestions.length > 0 &&
    suggestions.length === selected.length &&
    suggestions.every((id) => selected.includes(id));

  return (
    <section className="config-group">
      <header className="config-group__header">
        <h3>{title}</h3>
        <span className="config-group__count">{selected.length} tham số</span>
      </header>

      {suggestions.length > 0 && !suggestionMatches && (
        <button type="button" className="button button--ghost" onClick={onApplySuggestion}>
          Dùng gợi ý ({suggestions.length} tham số)
        </button>
      )}

      <input
        className="input"
        type="search"
        placeholder="Tìm tham số…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="config-group__list">
        {visible.slice(0, 60).map((parameter) => (
          <label key={parameter.id} className="config-group__item" title={parameter.id}>
            <input
              type="checkbox"
              checked={selected.includes(parameter.id)}
              onChange={() => onToggle(parameter.id)}
            />
            {parameter.name}
          </label>
        ))}
        {visible.length > 60 && (
          <p className="panel__hint">
            Còn {visible.length - 60} tham số nữa — dùng ô tìm để thu hẹp.
          </p>
        )}
      </div>
    </section>
  );
}
