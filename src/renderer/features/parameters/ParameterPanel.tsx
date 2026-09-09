import { useMemo, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import { runtimeRef } from '../../document/runtimeRef';
import type { ParameterInfo } from '../../core/cubism/ModelInfo';

/**
 * Auto-generated sliders, one per parameter the moc declares.
 *
 * Ranges come from the model itself rather than any config, so this panel works
 * for any model without setup — which is the whole premise of the app.
 */
export function ParameterPanel() {
  const info = useSessionStore((state) => state.info);
  const values = useSessionStore((state) => state.parameterValues);
  const pinned = useSessionStore((state) => state.pinned);
  const togglePin = useSessionStore((state) => state.togglePin);
  const clearPins = useSessionStore((state) => state.clearPins);
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    if (!info) return [];
    const needle = query.trim().toLowerCase();
    return info.parameterGroups
      .map((group) => ({
        ...group,
        parameters: group.parameterIndices
          .map((index) => info.parameters[index])
          .filter(
            (parameter) =>
              needle === '' ||
              parameter.name.toLowerCase().includes(needle) ||
              parameter.id.toLowerCase().includes(needle)
          )
      }))
      .filter((group) => group.parameters.length > 0);
  }, [info, query]);

  if (!info || !values) {
    return <aside className="panel panel--parameters" />;
  }

  const handleChange = (parameter: ParameterInfo, value: number): void => {
    // Setting a value implicitly pins it: otherwise physics or a motion would
    // overwrite the slider on the very next frame and it would snap back.
    runtimeRef.current?.setOverride(parameter.index, value);
    if (!pinned.has(parameter.index)) togglePin(parameter.index);
  };

  const handleReset = (parameter: ParameterInfo): void => {
    runtimeRef.current?.clearOverride(parameter.index);
    if (pinned.has(parameter.index)) togglePin(parameter.index);
    runtimeRef.current?.model.setParameterValueByIndex(parameter.index, parameter.default);
  };

  const handleResetAll = (): void => {
    runtimeRef.current?.clearAllOverrides();
    clearPins();
    runtimeRef.current?.resetToDefaults();
  };

  return (
    <aside className="panel panel--parameters">
      <header className="panel__header">
        <h2>Tham số ({info.parameters.length})</h2>
        <button type="button" className="button button--ghost" onClick={handleResetAll}>
          Reset tất cả
        </button>
      </header>

      <input
        className="input"
        type="search"
        placeholder="Tìm tham số…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="panel__scroll">
        {groups.map((group) => (
          <section key={group.id || '__ungrouped'} className="param-group">
            <h3 className="param-group__title">{group.name}</h3>
            {group.parameters.map((parameter) => (
              <ParameterSlider
                key={parameter.id}
                parameter={parameter}
                value={values[parameter.index] ?? parameter.default}
                isPinned={pinned.has(parameter.index)}
                onChange={handleChange}
                onReset={handleReset}
                onTogglePin={togglePin}
              />
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
}

interface SliderProps {
  parameter: ParameterInfo;
  value: number;
  isPinned: boolean;
  onChange(parameter: ParameterInfo, value: number): void;
  onReset(parameter: ParameterInfo): void;
  onTogglePin(parameterIndex: number): void;
}

function ParameterSlider({
  parameter,
  value,
  isPinned,
  onChange,
  onReset,
  onTogglePin
}: SliderProps) {
  const step = (parameter.maximum - parameter.minimum) / 200 || 0.01;

  return (
    <div className={`param${isPinned ? ' param--pinned' : ''}`}>
      <div className="param__labels">
        <button
          type="button"
          className="param__pin"
          title={isPinned ? 'Bỏ ghim (trả lại cho physics/motion)' : 'Ghim giá trị'}
          onClick={() => {
            if (isPinned) onReset(parameter);
            else {
              onTogglePin(parameter.index);
              onChange(parameter, value);
            }
          }}
        >
          {isPinned ? '📌' : '○'}
        </button>
        <span className="param__name" title={parameter.id}>
          {parameter.name}
        </span>
        {parameter.isBlendShape && <span className="param__badge">BS</span>}
        <span className="param__value">{value.toFixed(2)}</span>
      </div>
      <input
        className="param__slider"
        type="range"
        min={parameter.minimum}
        max={parameter.maximum}
        step={step}
        value={value}
        onChange={(event) => onChange(parameter, Number(event.target.value))}
        onDoubleClick={() => onReset(parameter)}
      />
    </div>
  );
}
