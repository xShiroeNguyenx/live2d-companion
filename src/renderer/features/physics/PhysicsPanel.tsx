import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import { physics3Store } from '../../document/stores/documentStores';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import { runtimeRef } from '../../document/runtimeRef';
import {
  applyChainFeel,
  chainName,
  NEUTRAL_FEEL,
  readChainFeel,
  recomputePhysicsMeta,
  type ChainFeel
} from './physicsOps';
import type { Physics3Json } from '@shared/types/live2d-files';

type Mode = 'simple' | 'advanced';

/**
 * Tunes physics3.json: how hair, ribbons and clothing swing.
 *
 * Physics is the setting people most want to change and least often can, because
 * the file speaks in mobility, delay and per-vertex acceleration. Simple mode
 * offers the two questions a user actually has — how far does it swing, how
 * quickly does it settle — and writes them onto the real fields. Advanced mode is
 * there when that is not enough.
 *
 * The test rig matters as much as the sliders: physics only shows itself in
 * motion, so there are buttons to blow wind and shake the model, and the chain
 * is drawn on the canvas as a pendulum.
 */
export function PhysicsPanel() {
  const info = useSessionStore((state) => state.info);
  const physics = physics3Store((state) => state.data);
  const physicsPath = physics3Store((state) => state.relativePath);
  const editPhysics = physics3Store((state) => state.edit);
  const setCanvasMode = useEditorUiStore((state) => state.setCanvasMode);
  const selectedChain = useEditorUiStore((state) => state.selectedPhysicsChain);
  const selectChain = useEditorUiStore((state) => state.selectPhysicsChain);

  const [mode, setMode] = useState<Mode>('simple');
  const [wind, setWind] = useState(0);
  const [filter, setFilter] = useState('');

  /**
   * The chain values as loaded, used as the reference for the macro sliders.
   *
   * Captured once per model: the macros are ratios against what the author
   * wrote, so they need a fixed origin. Recomputing it from the current values
   * would make each drag relative to the last, and the sliders would drift.
   */
  const baselineRef = useRef<Physics3Json | null>(null);
  useEffect(() => {
    if (physicsPath && !baselineRef.current) {
      baselineRef.current = structuredClone(physics);
    }
    if (!physicsPath) baselineRef.current = null;
  }, [physicsPath, physics]);

  // Physics is invisible while the model is still, so entering this panel turns
  // on the mouse-follow drag that makes a chain actually move.
  useEffect(() => {
    const previous = useSessionStore.getState().toggles.physics;
    if (!previous) useSessionStore.getState().setToggle('physics', true);
    return () => {
      runtimeRef.current?.setPhysicsWind(0, 0);
      setCanvasMode('none');
    };
  }, [setCanvasMode]);

  // Wind is applied to the live simulation rather than written to the file: it
  // is a test condition, not a property of the model.
  useEffect(() => {
    runtimeRef.current?.setPhysicsWind(wind, 0);
  }, [wind]);

  const chains = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return physics.PhysicsSettings.map((setting, index) => ({
      index,
      setting,
      name: chainName(physics, setting.Id)
    })).filter(
      (entry) =>
        needle === '' ||
        entry.name.toLowerCase().includes(needle) ||
        entry.setting.Id.toLowerCase().includes(needle)
    );
  }, [physics, filter]);

  const active =
    selectedChain !== null ? physics.PhysicsSettings[selectedChain] : null;
  const baselineChain =
    selectedChain !== null ? baselineRef.current?.PhysicsSettings[selectedChain] : null;

  const feel: ChainFeel =
    active && baselineChain ? readChainFeel(active, baselineChain) : NEUTRAL_FEEL;

  const updateFeel = (change: Partial<ChainFeel>): void => {
    if (selectedChain === null || !baselineChain) return;
    const next = { ...feel, ...change };

    editPhysics(
      'Chỉnh độ rung',
      (draft) => {
        const setting = draft.PhysicsSettings[selectedChain];
        if (setting) applyChainFeel(setting, baselineChain, next);
      },
      `physics:${selectedChain}:feel`
    );
  };

  const updateVertex = (
    vertexIndex: number,
    field: 'Mobility' | 'Delay' | 'Acceleration' | 'Radius',
    value: number
  ): void => {
    if (selectedChain === null) return;
    editPhysics(
      'Chỉnh đốt vật lý',
      (draft) => {
        const vertex = draft.PhysicsSettings[selectedChain]?.Vertices[vertexIndex];
        if (vertex) vertex[field] = value;
      },
      `physics:${selectedChain}:${vertexIndex}:${field}`
    );
  };

  const updateOutputScale = (outputIndex: number, value: number): void => {
    if (selectedChain === null) return;
    editPhysics(
      'Chỉnh biên độ',
      (draft) => {
        const output = draft.PhysicsSettings[selectedChain]?.Output[outputIndex];
        if (output) output.Scale = value;
      },
      `physics:${selectedChain}:out${outputIndex}`
    );
  };

  const handleResetChain = (): void => {
    if (selectedChain === null || !baselineChain) return;
    editPhysics('Trả chain về gốc', (draft) => {
      draft.PhysicsSettings[selectedChain] = structuredClone(baselineChain);
      recomputePhysicsMeta(draft);
    });
  };

  /** Swings the model briefly so the chains visibly react. */
  const handleShake = (): void => {
    const runtime = runtimeRef.current;
    if (!runtime || !info) return;

    const angle = info.parameters.find((parameter) => parameter.id === 'ParamAngleX');
    if (!angle) {
      window.alert('Model không có ParamAngleX để lắc thử.');
      return;
    }

    // A short scripted sine rather than a single jump: physics responds to
    // motion over time, and one instant change just snaps.
    const started = performance.now();
    const duration = 1600;
    const step = (): void => {
      const elapsed = performance.now() - started;
      if (elapsed > duration) {
        runtime.clearOverride(angle.index);
        return;
      }
      const phase = (elapsed / duration) * Math.PI * 6;
      const decay = 1 - elapsed / duration;
      runtime.setOverride(angle.index, Math.sin(phase) * angle.maximum * decay);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  if (!info) return <aside className="panel" />;

  if (!physicsPath) {
    return (
      <aside className="panel">
        <header className="panel__header">
          <h2>Rung lắc (Physics)</h2>
        </header>
        <p className="panel__warn">
          Model này chưa có file physics3.json, nên chưa có chuyển động rung lắc nào để
          chỉnh. Tạo physics mới cần dựng chuỗi đốt trong Cubism Editor.
        </p>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <header className="panel__header">
        <h2>Rung lắc ({physics.PhysicsSettings.length} chuỗi)</h2>
      </header>

      <div className="physics-rig">
        <button type="button" className="button" onClick={handleShake}>
          Lắc thử
        </button>
        <label className="physics-rig__wind">
          Gió
          <input
            type="range"
            min={-20}
            max={20}
            step={0.5}
            value={wind}
            onChange={(event) => setWind(Number(event.target.value))}
          />
          <button
            type="button"
            className="expr__action"
            title="Tắt gió"
            onClick={() => setWind(0)}
          >
            ✕
          </button>
        </label>
      </div>

      <p className="panel__hint">
        Kéo model bằng chuột (bật “Nhìn theo chuột” ở thanh trên) hoặc bấm “Lắc thử” để
        thấy tóc và trang phục phản ứng. Chuỗi đang chọn được vẽ trên model.
      </p>

      <input
        className="input"
        type="search"
        placeholder="Tìm chuỗi…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div className="physics-list">
        {chains.map((entry) => (
          <button
            key={entry.setting.Id}
            type="button"
            className={`physics-item${
              selectedChain === entry.index ? ' physics-item--active' : ''
            }`}
            onClick={() =>
              selectChain(selectedChain === entry.index ? null : entry.index)
            }
            title={entry.setting.Id}
          >
            <span className="physics-item__name">{entry.name}</span>
            <span className="physics-item__meta">{entry.setting.Vertices.length} đốt</span>
          </button>
        ))}
      </div>

      {active && (
        <section className="physics-detail panel__scroll">
          <nav className="subtabs">
            <button
              type="button"
              className={`subtab${mode === 'simple' ? ' subtab--active' : ''}`}
              onClick={() => setMode('simple')}
            >
              Đơn giản
            </button>
            <button
              type="button"
              className={`subtab${mode === 'advanced' ? ' subtab--active' : ''}`}
              onClick={() => setMode('advanced')}
            >
              Nâng cao
            </button>
          </nav>

          {mode === 'simple' ? (
            <>
              <label className="physics-macro">
                <span>
                  Biên độ lắc <em>{Math.round(feel.swing * 100)}%</em>
                </span>
                <input
                  type="range"
                  min={0}
                  max={3}
                  step={0.05}
                  value={feel.swing}
                  onChange={(event) => updateFeel({ swing: Number(event.target.value) })}
                />
              </label>
              <label className="physics-macro">
                <span>
                  Độ cứng <em>{Math.round(feel.stiffness * 100)}%</em>
                </span>
                <input
                  type="range"
                  min={0.2}
                  max={3}
                  step={0.05}
                  value={feel.stiffness}
                  onChange={(event) =>
                    updateFeel({ stiffness: Number(event.target.value) })
                  }
                />
              </label>
              <p className="panel__hint">
                Biên độ lớn = tóc bay xa hơn. Độ cứng lớn = bám sát đầu, dừng nhanh hơn.
              </p>
              <button type="button" className="button button--ghost" onClick={handleResetChain}>
                Trả chuỗi này về gốc
              </button>
            </>
          ) : (
            <>
              <h3 className="physics-detail__title">Đầu vào</h3>
              <table className="config-table">
                <tbody>
                  {active.Input.map((input, index) => (
                    <tr key={index}>
                      <td className="config-table__id">{input.Source.Id}</td>
                      <td>{input.Type}</td>
                      <td>{input.Weight}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="physics-detail__title">Đầu ra</h3>
              <table className="config-table">
                <thead>
                  <tr>
                    <th>Tham số</th>
                    <th>Đốt</th>
                    <th>Biên độ</th>
                  </tr>
                </thead>
                <tbody>
                  {active.Output.map((output, index) => (
                    <tr key={index}>
                      <td className="config-table__id">{output.Destination.Id}</td>
                      <td>{output.VertexIndex}</td>
                      <td>
                        <input
                          type="number"
                          step={0.1}
                          value={output.Scale}
                          onChange={(event) =>
                            updateOutputScale(index, Number(event.target.value))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="physics-detail__title">Các đốt</h3>
              <table className="config-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Mềm</th>
                    <th>Trễ</th>
                    <th>Bán kính</th>
                  </tr>
                </thead>
                <tbody>
                  {active.Vertices.map((vertex, index) => (
                    <tr key={index}>
                      <td>{index}</td>
                      <td>
                        <input
                          type="number"
                          min={0.01}
                          max={1}
                          step={0.01}
                          value={vertex.Mobility}
                          onChange={(event) =>
                            updateVertex(index, 'Mobility', Number(event.target.value))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0.01}
                          step={0.05}
                          value={vertex.Delay}
                          onChange={(event) =>
                            updateVertex(index, 'Delay', Number(event.target.value))
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={vertex.Radius}
                          onChange={(event) =>
                            updateVertex(index, 'Radius', Number(event.target.value))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
