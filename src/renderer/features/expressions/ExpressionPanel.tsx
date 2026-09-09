import { useMemo } from 'react';
import type { Exp3Json } from '@shared/types/live2d-files';
import { useSessionStore } from '../../document/stores/sessionStore';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import { expressionsStore, model3Store } from '../../document/stores/documentStores';
import { runtimeRef } from '../../document/runtimeRef';
import {
  captureExpression,
  findExpressionConflicts,
  proposeExpressionName
} from './expressionOps';

const BLEND_MODES = ['Add', 'Multiply', 'Overwrite'] as const;

/**
 * Creates and edits exp3.json files.
 *
 * The primary workflow is capture, not typing: the user poses the model with the
 * parameter sliders, presses one button, and the panel writes out only what
 * changed. Editing the resulting table by hand is the fallback.
 */
export function ExpressionPanel() {
  const info = useSessionStore((state) => state.info);
  const values = useSessionStore((state) => state.parameterValues);
  const set = expressionsStore((state) => state.data);
  const editExpressions = expressionsStore((state) => state.edit);
  const editModel3 = model3Store((state) => state.edit);
  const baseDir = useSessionStore((state) => state.baseDir);

  const active = useEditorUiStore((state) => state.activeExpressions);
  const selected = useEditorUiStore((state) => state.selectedExpression);
  const selectExpression = useEditorUiStore((state) => state.selectExpression);
  const toggleExpression = useEditorUiStore((state) => state.toggleExpression);
  const setExpressionWeight = useEditorUiStore((state) => state.setExpressionWeight);
  const clearExpressions = useEditorUiStore((state) => state.clearExpressions);

  const activeNames = useMemo(() => Object.keys(active), [active]);
  const conflicts = useMemo(
    () => findExpressionConflicts(set, activeNames),
    [set, activeNames]
  );

  const selectedExpression = selected ? set.byName[selected] : null;

  const handleCapture = (): void => {
    const runtime = runtimeRef.current;
    if (!info || !runtime) return;

    // Capture from the authored pose, not the drawn one: physics keeps hair
    // parameters permanently off their defaults, and capturing those would fill
    // the expression with dozens of values the user never set.
    const captured = captureExpression({ values: runtime.getAuthoredValues(), info });
    if (captured.Parameters.length === 0) {
      window.alert(
        'Model đang ở trạng thái mặc định — hãy kéo vài slider tham số trước khi lưu biểu cảm.'
      );
      return;
    }

    const { name, fileName } = proposeExpressionName(set, 'expression');
    const filePath = `${baseDir}${fileName}`;

    editExpressions(`Tạo biểu cảm "${name}"`, (draft) => {
      draft.byName[name] = captured;
      draft.files[name] = filePath;
      draft.order.push(name);
    });

    // model3.json is the index other runtimes read, so a new expression is not
    // usable by VTube Studio or a companion app until it is listed there.
    editModel3(`Thêm biểu cảm "${name}" vào model3`, (draft) => {
      const expressions = draft.FileReferences.Expressions ?? [];
      expressions.push({ Name: name, File: fileName });
      draft.FileReferences.Expressions = expressions;
    });

    selectExpression(name);
  };

  const handleDelete = (name: string): void => {
    if (!window.confirm(`Xoá biểu cảm "${name}"? File exp3.json sẽ không còn được dùng.`)) {
      return;
    }

    editExpressions(`Xoá biểu cảm "${name}"`, (draft) => {
      delete draft.byName[name];
      delete draft.files[name];
      draft.order = draft.order.filter((entry) => entry !== name);
    });
    editModel3(`Bỏ biểu cảm "${name}" khỏi model3`, (draft) => {
      draft.FileReferences.Expressions = (draft.FileReferences.Expressions ?? []).filter(
        (entry) => entry.Name !== name
      );
    });

    if (selected === name) selectExpression(null);
  };

  const handleDuplicate = (name: string): void => {
    const source = set.byName[name];
    if (!source) return;

    const proposal = proposeExpressionName(set, name);
    const filePath = `${baseDir}${proposal.fileName}`;
    const copy: Exp3Json = structuredClone(source);

    editExpressions(`Nhân bản biểu cảm "${name}"`, (draft) => {
      draft.byName[proposal.name] = copy;
      draft.files[proposal.name] = filePath;
      draft.order.push(proposal.name);
    });
    editModel3(`Thêm biểu cảm "${proposal.name}" vào model3`, (draft) => {
      const expressions = draft.FileReferences.Expressions ?? [];
      expressions.push({ Name: proposal.name, File: proposal.fileName });
      draft.FileReferences.Expressions = expressions;
    });
    selectExpression(proposal.name);
  };

  const updateParameter = (
    index: number,
    change: Partial<{ Value: number; Blend: (typeof BLEND_MODES)[number] }>
  ): void => {
    if (!selected) return;
    editExpressions(
      `Sửa biểu cảm "${selected}"`,
      (draft) => {
        const parameter = draft.byName[selected]?.Parameters[index];
        if (!parameter) return;
        if (change.Value !== undefined) parameter.Value = change.Value;
        if (change.Blend !== undefined) parameter.Blend = change.Blend;
      },
      // One drag of a value field is one undo entry.
      `expression:${selected}:${index}`
    );
  };

  const removeParameter = (index: number): void => {
    if (!selected) return;
    editExpressions(`Bỏ tham số khỏi "${selected}"`, (draft) => {
      draft.byName[selected]?.Parameters.splice(index, 1);
    });
  };

  const updateFade = (field: 'FadeInTime' | 'FadeOutTime', value: number): void => {
    if (!selected) return;
    editExpressions(
      `Sửa fade của "${selected}"`,
      (draft) => {
        const expression = draft.byName[selected];
        if (expression) expression[field] = value;
      },
      `expression:${selected}:${field}`
    );
  };

  /** Loads an expression's values into the sliders so it can be re-posed. */
  const handleLoadIntoSliders = (name: string): void => {
    const expression = set.byName[name];
    const runtime = runtimeRef.current;
    if (!expression || !runtime || !info) return;

    const byId = new Map(info.parameters.map((parameter) => [parameter.id, parameter]));
    runtime.clearAllOverrides();
    useSessionStore.getState().clearPins();

    for (const entry of expression.Parameters) {
      const parameter = byId.get(entry.Id);
      if (!parameter) continue;
      // Only additive entries map cleanly back onto a slider position.
      const value =
        (entry.Blend ?? 'Add') === 'Overwrite'
          ? entry.Value
          : parameter.default + entry.Value;
      const clamped = Math.max(parameter.minimum, Math.min(parameter.maximum, value));
      runtime.setOverride(parameter.index, clamped);
      useSessionStore.getState().togglePin(parameter.index);
    }
  };

  if (!info) return <aside className="panel" />;

  return (
    <aside className="panel">
      <header className="panel__header">
        <h2>Biểu cảm ({set.order.length})</h2>
        <button type="button" className="button" onClick={handleCapture}>
          Lưu dáng hiện tại
        </button>
      </header>

      <p className="panel__hint">
        Kéo slider ở tab “Tham số” để tạo dáng, rồi bấm “Lưu dáng hiện tại”. App chỉ ghi
        những tham số bạn đã thay đổi.
      </p>

      {set.order.length === 0 ? (
        <p className="panel__empty">Model chưa có biểu cảm nào.</p>
      ) : (
        <>
          <div className="expr-list">
            {set.order.map((name) => {
              const isActive = name in active;
              return (
                <div
                  key={name}
                  className={`expr${selected === name ? ' expr--selected' : ''}`}
                >
                  <label className="expr__preview" title="Bật để xem trên model">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => toggleExpression(name)}
                    />
                  </label>
                  <button
                    type="button"
                    className="expr__name"
                    onClick={() => selectExpression(selected === name ? null : name)}
                  >
                    {name}
                    <span className="expr__count">
                      {set.byName[name]?.Parameters.length ?? 0} tham số
                    </span>
                  </button>
                  {isActive && (
                    <input
                      className="expr__weight"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={active[name]}
                      title={`Độ mạnh ${Math.round(active[name] * 100)}%`}
                      onChange={(event) =>
                        setExpressionWeight(name, Number(event.target.value))
                      }
                    />
                  )}
                  <button
                    type="button"
                    className="expr__action"
                    title="Nạp vào slider để sửa dáng"
                    onClick={() => handleLoadIntoSliders(name)}
                  >
                    ↺
                  </button>
                  <button
                    type="button"
                    className="expr__action"
                    title="Nhân bản"
                    onClick={() => handleDuplicate(name)}
                  >
                    ⧉
                  </button>
                  <button
                    type="button"
                    className="expr__action expr__action--danger"
                    title="Xoá"
                    onClick={() => handleDelete(name)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>

          {activeNames.length > 0 && (
            <div className="expr-active">
              <span>{activeNames.length} biểu cảm đang bật</span>
              <button type="button" className="button button--ghost" onClick={clearExpressions}>
                Tắt hết
              </button>
            </div>
          )}

          {conflicts.size > 0 && (
            <div className="expr-conflict">
              <strong>Xung đột:</strong> {conflicts.size} tham số bị nhiều biểu cảm cùng
              điều khiển
              <ul>
                {[...conflicts].slice(0, 4).map(([id, names]) => (
                  <li key={id}>
                    {id} ← {names.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {selected && selectedExpression && (
        <section className="expr-detail panel__scroll">
          <h3>{selected}</h3>

          <div className="expr-fades">
            <label>
              Fade in
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={selectedExpression.FadeInTime ?? 0.5}
                onChange={(event) => updateFade('FadeInTime', Number(event.target.value))}
              />
            </label>
            <label>
              Fade out
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                value={selectedExpression.FadeOutTime ?? 0.5}
                onChange={(event) => updateFade('FadeOutTime', Number(event.target.value))}
              />
            </label>
          </div>

          <table className="expr-table">
            <thead>
              <tr>
                <th>Tham số</th>
                <th>Giá trị</th>
                <th>Blend</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {selectedExpression.Parameters.map((parameter, index) => {
                const known = info.parameters.find((entry) => entry.id === parameter.Id);
                return (
                  <tr key={`${parameter.Id}-${index}`}>
                    <td title={parameter.Id}>
                      {known?.name ?? parameter.Id}
                      {!known && <span className="expr-table__warn"> (không có trong moc)</span>}
                    </td>
                    <td>
                      <input
                        type="number"
                        step={0.01}
                        value={parameter.Value}
                        onChange={(event) =>
                          updateParameter(index, { Value: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>
                      <select
                        value={parameter.Blend ?? 'Add'}
                        onChange={(event) =>
                          updateParameter(index, {
                            Blend: event.target.value as (typeof BLEND_MODES)[number]
                          })
                        }
                      >
                        {BLEND_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="expr__action expr__action--danger"
                        onClick={() => removeParameter(index)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </aside>
  );
}
