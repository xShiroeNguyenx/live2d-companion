import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import { model3Store, textureStore } from '../../document/stores/documentStores';
import { cancelDrawablePick, requestDrawablePick } from '../../document/canvasPick';
import {
  createPaintLayer,
  createRecolorLayer,
  textureSession
} from '../../document/textureSession';
import type { RecolorLayer } from '../../core/texture/TextureCompositor';
import { descendantParts } from '../../core/cubism/ModelInfo';
import { drawablesForPart } from '../../core/texture/RegionMasker';
import { PaintCanvas } from './PaintCanvas';

type Mode = 'recolor' | 'paint';

/** How long edits settle before the composite is pushed to the model. */
const PREVIEW_DEBOUNCE_MS = 90;

/**
 * Recolours and paints on the model's textures.
 *
 * The whole design turns on one idea: the user picks a region by clicking the
 * model, not by drawing a selection. Behind that click, the mesh's UV triangles
 * are rasterised into a mask, so "make the jacket blue" only ever touches the
 * jacket's own artwork — never the skin next to it in the atlas.
 *
 * Everything is non-destructive. Layers hold hue/saturation numbers, the
 * original PNG is untouched, and the flattened result is only written when the
 * user applies it.
 */
export function TexturePanel() {
  const info = useSessionStore((state) => state.info);
  const workspace = useSessionStore((state) => state.workspace);
  const baseDir = useSessionStore((state) => state.baseDir);
  const textureSizes = useSessionStore((state) => state.textureSizes);
  const model3 = model3Store((state) => state.data);
  const edits = textureStore((state) => state.data);
  const editTextures = textureStore((state) => state.edit);
  const canvasMode = useEditorUiStore((state) => state.canvasMode);
  const setCanvasMode = useEditorUiStore((state) => state.setCanvasMode);

  const [mode, setMode] = useState<Mode>('recolor');
  const [textureIndex, setTextureIndex] = useState(0);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const layers = edits.layers;
  const activeLayer = layers.find((layer) => layer.id === selectedLayer) ?? null;

  /**
   * Re-composites and pushes the result to the model.
   *
   * Debounced because a slider drag fires continuously and each composite is a
   * full-texture GPU pass; at 90ms the preview still feels immediate while the
   * work stays off the critical path.
   */
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const composite = textureSession.composite(textureIndex, layers);
      if (composite) void textureSession.uploadToModel(textureIndex, composite);
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [layers, textureIndex]);

  useEffect(() => () => setCanvasMode('none'), [setCanvasMode]);

  const showStatus = (message: string): void => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 3200);
  };

  /**
   * Starts a pick and turns whatever the user clicks into a masked layer.
   *
   * The mask covers the whole part, not just the clicked mesh: a jacket is
   * usually several meshes, and recolouring one of them would leave the rest the
   * old colour.
   */
  const handlePickRegion = (): void => {
    setCanvasMode('pickDrawable');
    requestDrawablePick((drawableId) => {
      setCanvasMode('none');
      if (!info) return;

      const drawable = info.drawables.find((entry) => entry.id === drawableId);
      if (!drawable) return;

      const partIndex = drawable.parentPartIndex;
      const partName =
        partIndex >= 0 ? (info.parts[partIndex]?.name ?? drawableId) : drawableId;

      // Include child parts, so clicking a jacket also catches its trim.
      const parts = partIndex >= 0 ? descendantParts(info, partIndex) : [];
      const byTexture = drawablesForPart(info, parts);
      const drawables = byTexture.get(drawable.textureIndex) ?? [drawable.index];

      const mask = textureSession.buildMask(drawable.textureIndex, drawables);
      if (!mask) {
        showStatus('Không tạo được vùng chọn cho phần này.');
        return;
      }

      const layer = createRecolorLayer(drawable.textureIndex, partName, mask);
      editTextures(`Thêm lớp đổi màu "${partName}"`, (draft) => {
        draft.layers.push(layer);
      });
      setTextureIndex(drawable.textureIndex);
      setSelectedLayer(layer.id);
      showStatus(`Đã chọn "${partName}" (${drawables.length} mesh). Kéo slider để đổi màu.`);
    });
  };

  const handleCancelPick = (): void => {
    cancelDrawablePick();
    setCanvasMode('none');
  };

  const updateLayer = useCallback(
    (layerId: string, change: Partial<RecolorLayer>, coalesceKey?: string) => {
      editTextures(
        'Chỉnh màu',
        (draft) => {
          const layer = draft.layers.find((entry) => entry.id === layerId);
          if (!layer || layer.kind !== 'recolor') return;
          Object.assign(layer, change);
        },
        coalesceKey
      );
    },
    [editTextures]
  );

  const handleDeleteLayer = (layerId: string): void => {
    editTextures('Xoá lớp', (draft) => {
      draft.layers = draft.layers.filter((entry) => entry.id !== layerId);
    });
    textureSession.invalidateMask(layerId);
    if (selectedLayer === layerId) setSelectedLayer(null);
  };

  const handleToggleLayer = (layerId: string): void => {
    editTextures('Bật/tắt lớp', (draft) => {
      const layer = draft.layers.find((entry) => entry.id === layerId);
      if (layer) layer.visible = !layer.visible;
    });
  };

  const handleAddPaintLayer = (): void => {
    const layer = createPaintLayer(textureIndex, `Vẽ ${layers.length + 1}`);
    editTextures('Thêm lớp vẽ', (draft) => {
      draft.layers.push(layer);
    });
    setSelectedLayer(layer.id);
    setMode('paint');
  };

  /**
   * Flattens the layers into the working PNG.
   *
   * Applying is explicit rather than automatic: it overwrites the texture the
   * model loads from, and the point of the layer stack is that the user can keep
   * adjusting until they are happy first.
   */
  const handleApply = async (): Promise<void> => {
    if (!workspace) return;
    setBusy(true);
    try {
      let written = 0;
      for (const [index, path] of model3.FileReferences.Textures.entries()) {
        const touched = layers.some((layer) => layer.textureIndex === index);
        if (!touched) continue;

        const composite = textureSession.composite(index, layers);
        if (!composite) continue;

        const data = await textureSession.encodePng(composite);
        const result = await window.api.writeTexture({
          workspaceId: workspace.id,
          relativePath: `${baseDir}${path}`,
          data
        });
        if (!result.ok) {
          showStatus(result.error ?? 'Ghi texture thất bại.');
          return;
        }
        written += 1;
      }
      showStatus(
        written > 0
          ? `Đã ghi ${written} texture. Xuất model để dùng bên ngoài.`
          : 'Chưa có thay đổi nào để ghi.'
      );
    } finally {
      setBusy(false);
    }
  };

  const textureOptions = useMemo(
    () =>
      model3.FileReferences.Textures.map((path, index) => ({
        index,
        label: path.slice(path.lastIndexOf('/') + 1),
        size: textureSizes[index]
      })),
    [model3.FileReferences.Textures, textureSizes]
  );

  if (!info) return <aside className="panel" />;

  return (
    <aside className="panel">
      <nav className="subtabs">
        <button
          type="button"
          className={`subtab${mode === 'recolor' ? ' subtab--active' : ''}`}
          onClick={() => setMode('recolor')}
        >
          Đổi màu
        </button>
        <button
          type="button"
          className={`subtab${mode === 'paint' ? ' subtab--active' : ''}`}
          onClick={() => setMode('paint')}
        >
          Vẽ thêm
        </button>
      </nav>

      {textureOptions.length > 1 && (
        <label className="texture-picker">
          Texture
          <select
            value={textureIndex}
            onChange={(event) => setTextureIndex(Number(event.target.value))}
          >
            {textureOptions.map((option) => (
              <option key={option.index} value={option.index}>
                {option.label}
                {option.size ? ` (${option.size.width}×${option.size.height})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {mode === 'recolor' ? (
        <>
          <p className="panel__hint">
            Bấm nút bên dưới rồi bấm vào phần muốn đổi màu ngay trên model — ví dụ cái áo.
            App tự khoanh đúng vùng của phần đó trên ảnh, không lem sang da hay tóc.
          </p>

          <div className="texture-tools">
            {canvasMode === 'pickDrawable' ? (
              <button type="button" className="button button--ghost" onClick={handleCancelPick}>
                Huỷ chọn
              </button>
            ) : (
              <button type="button" className="button" onClick={handlePickRegion}>
                Chọn vùng trên model
              </button>
            )}
          </div>

          {status && <p className="pose__flash">{status}</p>}

          <div className="layer-list">
            {layers.length === 0 && (
              <p className="panel__empty">Chưa có lớp nào. Chọn một vùng để bắt đầu.</p>
            )}
            {layers.map((layer) => (
              <div
                key={layer.id}
                className={`layer${selectedLayer === layer.id ? ' layer--active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={layer.visible}
                  title="Bật/tắt lớp"
                  onChange={() => handleToggleLayer(layer.id)}
                />
                <button
                  type="button"
                  className="layer__name"
                  onClick={() => setSelectedLayer(layer.id)}
                >
                  {layer.name}
                  <span className="layer__kind">
                    {layer.kind === 'recolor' ? 'màu' : 'vẽ'}
                  </span>
                </button>
                <button
                  type="button"
                  className="expr__action expr__action--danger"
                  onClick={() => handleDeleteLayer(layer.id)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {activeLayer?.kind === 'recolor' && (
            <section className="recolor panel__scroll">
              <label className="physics-macro">
                <span>
                  Màu sắc <em>{Math.round(activeLayer.hue)}°</em>
                </span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={activeLayer.hue}
                  onChange={(event) =>
                    updateLayer(
                      activeLayer.id,
                      { hue: Number(event.target.value) },
                      `texture:${activeLayer.id}:hue`
                    )
                  }
                />
              </label>

              <label className="physics-macro">
                <span>
                  Độ tươi <em>{Math.round(activeLayer.saturation * 100)}%</em>
                </span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.02}
                  value={activeLayer.saturation}
                  onChange={(event) =>
                    updateLayer(
                      activeLayer.id,
                      { saturation: Number(event.target.value) },
                      `texture:${activeLayer.id}:sat`
                    )
                  }
                />
              </label>

              <label className="physics-macro">
                <span>
                  Độ sáng <em>{Math.round(activeLayer.lightness * 100)}%</em>
                </span>
                <input
                  type="range"
                  min={-1}
                  max={1}
                  step={0.02}
                  value={activeLayer.lightness}
                  onChange={(event) =>
                    updateLayer(
                      activeLayer.id,
                      { lightness: Number(event.target.value) },
                      `texture:${activeLayer.id}:light`
                    )
                  }
                />
              </label>

              <label className="recolor__colorize">
                <input
                  type="checkbox"
                  checked={activeLayer.colorize.enabled}
                  onChange={(event) =>
                    updateLayer(activeLayer.id, {
                      colorize: { ...activeLayer.colorize, enabled: event.target.checked }
                    })
                  }
                />
                Đổi hẳn sang màu
                <input
                  type="color"
                  value={activeLayer.colorize.color}
                  onChange={(event) =>
                    updateLayer(
                      activeLayer.id,
                      {
                        colorize: {
                          ...activeLayer.colorize,
                          enabled: true,
                          color: event.target.value
                        }
                      },
                      `texture:${activeLayer.id}:color`
                    )
                  }
                />
              </label>

              {activeLayer.colorize.enabled && (
                <label className="physics-macro">
                  <span>
                    Mức độ <em>{Math.round(activeLayer.colorize.strength * 100)}%</em>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.02}
                    value={activeLayer.colorize.strength}
                    onChange={(event) =>
                      updateLayer(
                        activeLayer.id,
                        {
                          colorize: {
                            ...activeLayer.colorize,
                            strength: Number(event.target.value)
                          }
                        },
                        `texture:${activeLayer.id}:strength`
                      )
                    }
                  />
                </label>
              )}

              <p className="panel__hint">
                “Đổi hẳn sang màu” giữ nguyên nếp gấp và bóng đổ của tranh gốc, chỉ thay
                tông màu — nên áo vẫn trông có chiều sâu chứ không bị bẹt.
              </p>
            </section>
          )}
        </>
      ) : (
        <PaintCanvas
          textureIndex={textureIndex}
          layers={layers}
          onStrokeEnd={() => {
            const composite = textureSession.composite(textureIndex, layers);
            if (composite) void textureSession.uploadToModel(textureIndex, composite);
          }}
          onAddLayer={handleAddPaintLayer}
        />
      )}

      <div className="texture-apply">
        <button
          type="button"
          className="button"
          disabled={busy || layers.length === 0}
          onClick={() => void handleApply()}
        >
          {busy ? 'Đang ghi…' : 'Ghi vào texture'}
        </button>
        <span className="panel__hint">
          Ghi rồi mới xuất được. Ảnh gốc trong workspace vẫn có bản backup.
        </span>
      </div>
    </aside>
  );
}
