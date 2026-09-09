import { useEffect, useMemo, useState } from 'react';
import { useSessionStore } from '../../document/stores/sessionStore';
import { useEditorUiStore } from '../../document/stores/editorUiStore';
import { expressionsStore, model3Store, pose3Store } from '../../document/stores/documentStores';
import { runtimeRef } from '../../document/runtimeRef';
import { cancelDrawablePick, requestDrawablePick } from '../../document/canvasPick';
import { buildDrawableGroups, buildPartTree, directDrawables } from '../../core/cubism/ModelInfo';
import { proposeExpressionName } from '../expressions/expressionOps';
import {
  detectOutfitParameters,
  outfitExpression,
  outfitFileBaseName
} from './outfitParameters';
import type { OutfitParameter } from './outfitParameters';

type Mode = 'parts' | 'outfits';

/**
 * Shows and hides parts of the model, and groups them into switchable outfits.
 *
 * Two modes because there are two different jobs. Most of the time a user wants
 * "take the jacket off", which is one checkbox and needs no concept of a group.
 * Only when a model ships several complete outfits does the pose-group idea —
 * one member visible at a time, cross-faded — earn its complexity, so it lives
 * behind its own tab with an explanation.
 *
 * The hard part for a non-technical user is not the mechanism, it is working out
 * which of two dozen Japanese-named parts is the jacket. Both modes solve that
 * the same way: hovering a row fades everything else on the model, and there is
 * a "click the model" button for going the other direction.
 *
 * Some models assign no mesh to any part at all — every moc exported by Cubism
 * 3.0 does. There the part list is a list of empty folders, so the parts mode
 * lists meshes directly instead, grouped by {@link buildDrawableGroups}. Outfit
 * groups still need real parts, because part ids are what pose3.json refers to,
 * so that tab explains itself rather than offering controls that could only
 * produce a file the runtime ignores.
 */
export function PosePanel() {
  const info = useSessionStore((state) => state.info);
  const baseDir = useSessionStore((state) => state.baseDir);
  const pose = pose3Store((state) => state.data);
  const posePath = pose3Store((state) => state.relativePath);
  const editPose = pose3Store((state) => state.edit);
  const loadPose = pose3Store((state) => state.load);
  const editModel3 = model3Store((state) => state.edit);
  const expressions = expressionsStore((state) => state.data);
  const editExpressions = expressionsStore((state) => state.edit);
  const canvasMode = useEditorUiStore((state) => state.canvasMode);
  const setCanvasMode = useEditorUiStore((state) => state.setCanvasMode);

  const [mode, setMode] = useState<Mode>('parts');
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  /** Meshes hidden individually, for parts that own several garments. */
  const [hiddenDrawables, setHiddenDrawables] = useState<Set<number>>(new Set());
  /** Parts whose individual meshes are listed. */
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');
  const [pendingGroup, setPendingGroup] = useState<number[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  const partTree = useMemo(() => (info ? buildPartTree(info) : []), [info]);

  /** True when the part tree describes real artwork, false when it is empty folders. */
  const hasParts = info?.hasPartedDrawables ?? true;

  const drawableGroups = useMemo(
    () => (info && !hasParts ? buildDrawableGroups(info) : []),
    [info, hasParts]
  );

  /**
   * The model's own outfit switches, discovered by probing the runtime.
   *
   * Held in state rather than derived with useMemo because finding them means
   * driving the model through every candidate parameter, which is far too much
   * work to redo on a render. It runs once per model, in an effect.
   */
  const [outfitSwitches, setOutfitSwitches] = useState<OutfitParameter[]>([]);
  /** Whether the sweep has already run for this model. */
  const [detected, setDetected] = useState(false);
  /** Switches the user has turned on, by parameter index. */
  const [wornSwitches, setWornSwitches] = useState<Set<number>>(new Set());

  /** Cleared on model change so a stale model's switches are never shown. */
  useEffect(() => {
    setOutfitSwitches([]);
    setWornSwitches(new Set());
    setDetected(false);
  }, [info]);

  /**
   * Runs detection, once, when the user first opens the outfit tab.
   *
   * Not on mount. Detection drives the model through every candidate parameter
   * and puts it back; doing that while the user is holding a slider means the
   * pose they are composing briefly is not theirs, and anything reading the
   * model in that window — capturing an expression, recording a motion frame —
   * sees defaults. Waiting until the tab is actually opened confines the sweep
   * to a moment when nothing else is driving the model.
   */
  const ensureDetected = (): void => {
    if (detected) return;
    setDetected(true);
    const runtime = runtimeRef.current;
    if (!info || !runtime) return;
    setOutfitSwitches(
      detectOutfitParameters(info, {
        opacitiesAt: (parameterIndex, value) => runtime.probeOpacities(parameterIndex, value)
      })
    );
  };

  /**
   * Which mesh groups are expanded.
   *
   * All closed initially: several hundred rows opened at once is the exact
   * list this grouping exists to spare the user.
   */
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  /** Parts already used by a pose group; they cannot join a second one. */
  const claimed = useMemo(() => {
    const set = new Set<string>();
    for (const group of pose.Groups) {
      for (const member of group) {
        set.add(member.Id);
        for (const link of member.Link) set.add(link);
      }
    }
    return set;
  }, [pose.Groups]);

  // The runtime owns visibility; React only holds the intent.
  useEffect(() => {
    runtimeRef.current?.setHiddenParts(hidden);
  }, [hidden]);

  useEffect(() => {
    runtimeRef.current?.setHiddenDrawables(hiddenDrawables);
  }, [hiddenDrawables]);

  // Clear the preview when the panel goes away, or a dimmed model would be left
  // behind on another tab.
  useEffect(
    () => () => {
      runtimeRef.current?.setIsolatedPart(null);
      runtimeRef.current?.setIsolatedDrawables(null);
      runtimeRef.current?.setHiddenParts([]);
      runtimeRef.current?.setHiddenDrawables([]);
    },
    []
  );

  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return partTree;
    return partTree.filter(
      (node) =>
        node.part.name.toLowerCase().includes(needle) ||
        node.part.id.toLowerCase().includes(needle)
    );
  }, [partTree, filter]);

  /** Mesh groups matching the filter, with empty groups dropped. */
  const filteredGroups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle === '') return drawableGroups;
    return drawableGroups
      .map((group) => ({
        ...group,
        drawables: group.drawables.filter((drawable) =>
          drawable.id.toLowerCase().includes(needle)
        )
      }))
      .filter((group) => group.drawables.length > 0);
  }, [drawableGroups, filter]);

  const toggleGroup = (key: string): void => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /** Hides or shows a whole group in one action. */
  const setGroupHidden = (indices: number[], hide: boolean): void => {
    setHiddenDrawables((current) => {
      const next = new Set(current);
      for (const index of indices) {
        if (hide) next.add(index);
        else next.delete(index);
      }
      return next;
    });
  };

  const showFlash = (message: string): void => {
    setFlash(message);
    window.setTimeout(() => setFlash(null), 2600);
  };

  const partByIndex = (index: number) => info?.parts[index];

  const toggleDrawableHidden = (drawableIndex: number): void => {
    setHiddenDrawables((current) => {
      const next = new Set(current);
      if (next.has(drawableIndex)) next.delete(drawableIndex);
      else next.add(drawableIndex);
      return next;
    });
  };

  const toggleExpanded = (partIndex: number): void => {
    setExpandedParts((current) => {
      const next = new Set(current);
      if (next.has(partIndex)) next.delete(partIndex);
      else next.add(partIndex);
      return next;
    });
  };

  const toggleHidden = (partIndex: number): void => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(partIndex)) next.delete(partIndex);
      else next.add(partIndex);
      return next;
    });
  };

  /** Finds the part that owns whatever mesh the user clicked. */
  const startPickFromModel = (onPart: (partIndex: number) => void): void => {
    setCanvasMode('pickDrawable');
    requestDrawablePick((drawableId) => {
      setCanvasMode('none');
      if (!info) return;
      const drawable = info.drawables.find((entry) => entry.id === drawableId);
      if (!drawable || drawable.parentPartIndex < 0) {
        showFlash('Mesh này không thuộc part nào.');
        return;
      }
      onPart(drawable.parentPartIndex);
    });
  };

  /**
   * Picks a single mesh, for models where clicking cannot resolve to a part.
   *
   * Separate from {@link startPickFromModel} because the two report failure
   * differently: there, an unparented mesh is a dead end worth a message; here
   * it is the normal case and the click simply works.
   */
  const startMeshPick = (): void => {
    setCanvasMode('pickDrawable');
    requestDrawablePick((drawableId) => {
      setCanvasMode('none');
      if (!info) return;
      const drawable = info.drawables.find((entry) => entry.id === drawableId);
      if (!drawable) return;
      toggleDrawableHidden(drawable.index);
      setOpenGroups((current) => {
        const group = drawableGroups.find((entry) =>
          entry.drawables.some((item) => item.index === drawable.index)
        );
        if (!group || current.has(group.key)) return current;
        return new Set(current).add(group.key);
      });
      showFlash(
        hiddenDrawables.has(drawable.index)
          ? `Đã hiện lại "${drawable.id}".`
          : `Đã ẩn "${drawable.id}".`
      );
    });
  };

  const handleCancelPick = (): void => {
    cancelDrawablePick();
    setCanvasMode('none');
  };

  const ensurePoseFile = (): void => {
    if (posePath) return;
    const fileName = 'pose.pose3.json';
    loadPose({ Type: 'Live2D Pose', FadeInTime: 0.5, Groups: [] }, `${baseDir}${fileName}`);
    editModel3('Thêm pose3.json vào model3', (draft) => {
      draft.FileReferences.Pose = fileName;
    });
  };

  const addToPendingGroup = (partIndex: number): void => {
    const part = partByIndex(partIndex);
    if (!part) return;
    if (claimed.has(part.id)) {
      showFlash(`"${part.name}" đã thuộc một bộ khác.`);
      return;
    }
    setPendingGroup((current) =>
      current.includes(partIndex) ? current : [...current, partIndex]
    );
  };

  const handleCreateGroup = (): void => {
    if (!info || pendingGroup.length < 2) return;
    ensurePoseFile();

    const members = pendingGroup
      .map((index) => info.parts[index])
      .filter(Boolean)
      .map((part) => ({ Id: part.id, Link: [] as string[] }));

    editPose(`Tạo bộ trang phục (${members.length} lựa chọn)`, (draft) => {
      draft.Groups.push(members);
    });
    setPendingGroup([]);
    showFlash('Đã tạo bộ. Bấm vào từng lựa chọn để xem thử.');
  };

  const handleDeleteGroup = (groupIndex: number): void => {
    editPose(`Xoá bộ ${groupIndex + 1}`, (draft) => {
      draft.Groups.splice(groupIndex, 1);
    });
  };

  const handleRemoveMember = (groupIndex: number, memberIndex: number): void => {
    editPose('Bỏ một lựa chọn khỏi bộ', (draft) => {
      draft.Groups[groupIndex]?.splice(memberIndex, 1);
      // Fewer than two members is no longer a choice between anything.
      if ((draft.Groups[groupIndex]?.length ?? 0) < 2) draft.Groups.splice(groupIndex, 1);
    });
  };

  /** Previews one member of a group by hiding its siblings. */
  const handleShowMember = (groupIndex: number, memberIndex: number): void => {
    if (!info) return;
    const group = pose.Groups[groupIndex];
    if (!group) return;

    const byId = new Map(info.parts.map((part) => [part.id, part.index]));
    setHidden((current) => {
      const next = new Set(current);
      for (const [index, member] of group.entries()) {
        for (const id of [member.Id, ...member.Link]) {
          const partIndex = byId.get(id);
          if (partIndex === undefined) continue;
          if (index === memberIndex) next.delete(partIndex);
          else next.add(partIndex);
        }
      }
      return next;
    });
  };

  /**
   * Turns one of the model’s own switches on or off, live.
   *
   * Driven through parameter overrides rather than by hiding meshes, because
   * that is the mechanism the author built: the moc already knows which artwork
   * belongs to the outfit, including pieces a mesh-level guess would miss.
   */
  const toggleWorn = (parameter: OutfitParameter): void => {
    setWornSwitches((current) => {
      const next = new Set(current);
      if (next.has(parameter.index)) next.delete(parameter.index);
      else next.add(parameter.index);

      // Drive every switch, not just the one clicked. An unticked switch has
      // to be forced to 0 rather than merely released: several of these are on
      // by default in the moc, so releasing would leave the old outfit showing
      // underneath the new one — and the preview would then disagree with the
      // file that Save writes, which is the one thing it must not do.
      const runtime = runtimeRef.current;
      for (const entry of outfitSwitches) {
        runtime?.setOverride(entry.index, next.has(entry.index) ? 1 : 0);
      }
      return next;
    });
  };

  /** Puts every switch back to what the moc says, clearing the preview. */
  const resetWorn = (): void => {
    const runtime = runtimeRef.current;
    for (const parameter of outfitSwitches) runtime?.clearOverride(parameter.index);
    setWornSwitches(new Set());
  };

  /**
   * Writes what is currently worn out as an exp3.json, listed in model3.json.
   *
   * An expression rather than a pose group because pose3.json addresses parts,
   * which this model does not have — and because an expression is what a runtime
   * can switch to by name, which is what "an outfit the app can choose" needs.
   *
   * Every detected switch is written, not only the worn ones: the unworn go out
   * as 0 so that selecting this outfit also turns off whichever one was on
   * before. Without that, switching between two saved outfits would show both.
   */
  const handleSaveWorn = (): void => {
    if (wornSwitches.size === 0) {
      showFlash('Chưa chọn bộ nào — bật ít nhất một lựa chọn rồi lưu.');
      return;
    }

    const worn = outfitSwitches.filter((parameter) => wornSwitches.has(parameter.index));
    const baseName = worn.map(outfitFileBaseName).join('_').slice(0, 40);
    const { name, fileName } = proposeExpressionName(expressions, baseName || 'outfit');
    const document = outfitExpression(outfitSwitches, wornSwitches);

    editExpressions(`Lưu bộ trang phục "${name}"`, (draft) => {
      draft.byName[name] = document;
      draft.files[name] = `${baseDir}${fileName}`;
      draft.order.push(name);
    });
    editModel3(`Thêm bộ "${name}" vào model3`, (draft) => {
      const list = draft.FileReferences.Expressions ?? [];
      list.push({ Name: name, File: fileName });
      draft.FileReferences.Expressions = list;
    });

    showFlash(`Đã lưu "${name}" — xuất model ra là dùng được.`);
  };

  const updateFade = (value: number): void => {
    editPose(
      'Sửa thời gian chuyển',
      (draft) => {
        draft.FadeInTime = value;
      },
      'pose:fade'
    );
  };

  if (!info) return <aside className="panel" />;

  return (
    <aside className="panel">
      <nav className="subtabs">
        <button
          type="button"
          className={`subtab${mode === 'parts' ? ' subtab--active' : ''}`}
          onClick={() => setMode('parts')}
        >
          Ẩn / hiện phần
        </button>
        <button
          type="button"
          className={`subtab${mode === 'outfits' ? ' subtab--active' : ''}`}
          onClick={() => {
            setMode('outfits');
            ensureDetected();
          }}
        >
          Bộ trang phục ({pose.Groups.length + outfitSwitches.length})
        </button>
      </nav>

      {flash && <p className="pose__flash">{flash}</p>}

      {mode === 'parts' ? (
        <>
          {hasParts ? (
            <p className="panel__hint">
              Bỏ tick để ẩn một phần (áo khoác, nơ, kính…). Đưa chuột vào một dòng để
              thấy phần đó sáng lên trên model.
            </p>
          ) : (
            <>
              <p className="panel__warn">
                Model này không gán hình vào part nào (thường gặp ở file xuất từ Cubism
                3.0). Danh sách part vì thế trống, nên bên dưới là {info.drawables.length}{' '}
                hình của model, gom theo vị trí trên thân.
              </p>
              <p className="panel__hint">
                Bỏ tick để ẩn một hình. Đưa chuột vào một dòng để thấy hình đó sáng lên
                trên model.
              </p>
            </>
          )}

          <div className="pose__tools">
            {canvasMode === 'pickDrawable' ? (
              <button type="button" className="button button--ghost" onClick={handleCancelPick}>
                Huỷ chọn
              </button>
            ) : (
              <button
                type="button"
                className="button"
                onClick={() => {
                  if (!hasParts) {
                    startMeshPick();
                    return;
                  }
                  startPickFromModel((partIndex) => {
                    toggleHidden(partIndex);
                    const part = partByIndex(partIndex);
                    showFlash(
                      hidden.has(partIndex)
                        ? `Đã hiện lại "${part?.name}".`
                        : `Đã ẩn "${part?.name}".`
                    );
                  });
                }}
              >
                Bấm lên model để ẩn/hiện
              </button>
            )}
            {(hidden.size > 0 || hiddenDrawables.size > 0) && (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  setHidden(new Set());
                  setHiddenDrawables(new Set());
                }}
              >
                Hiện lại hết ({hidden.size + hiddenDrawables.size})
              </button>
            )}
          </div>

          <input
            className="input"
            type="search"
            placeholder={hasParts ? 'Tìm phần…' : 'Tìm hình…'}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />

          {hasParts ? (
          <div className="panel__scroll" onMouseLeave={() => runtimeRef.current?.setIsolatedPart(null)}>
            {visibleRows.map((node) => {
              const isHidden = hidden.has(node.part.index);
              const ownMeshes = directDrawables(info, node.part.index);
              const isExpanded = expandedParts.has(node.part.index);

              return (
                <div key={node.part.id}>
                  <div
                    className={`part-row${isHidden ? ' part-row--hidden' : ''}`}
                    style={{ paddingLeft: `${node.depth * 12}px` }}
                    onMouseEnter={() => runtimeRef.current?.setIsolatedPart(node.part.index)}
                    title={node.part.id}
                  >
                    {/* Only parts that own several meshes can be broken down;
                        for the rest the disclosure would open an empty list. */}
                    {ownMeshes.length > 1 ? (
                      <button
                        type="button"
                        className={`part-row__expand${
                          isExpanded ? ' part-row__expand--open' : ''
                        }`}
                        title={
                          isExpanded
                            ? 'Thu gọn danh sách hình'
                            : `Mở ra để ẩn/hiện từng hình riêng (${ownMeshes.length} hình)`
                        }
                        onClick={() => toggleExpanded(node.part.index)}
                      >
                        {isExpanded ? '▾' : '▸'} {ownMeshes.length}
                      </button>
                    ) : (
                      <span className="part-row__expand part-row__expand--empty" />
                    )}

                    <label className="part-row__toggle">
                      <input
                        type="checkbox"
                        checked={!isHidden}
                        disabled={node.totalDrawableCount === 0}
                        title={
                          node.totalDrawableCount === 0
                            ? 'Phần này không chứa hình nào nên không ẩn/hiện được — nó chỉ dùng để xoay'
                            : undefined
                        }
                        onChange={() => toggleHidden(node.part.index)}
                      />
                    </label>
                    <span
                      className={`part-row__name${
                        node.totalDrawableCount === 0 ? ' part-row__name--empty' : ''
                      }`}
                    >
                      {node.part.name}
                    </span>
                    <span className="part-row__count">
                      {node.totalDrawableCount === 0
                        ? 'chỉ để xoay'
                        : ownMeshes.length === node.totalDrawableCount
                          ? `${node.totalDrawableCount} hình`
                          : `${node.totalDrawableCount} hình (${ownMeshes.length} của riêng nó)`}
                    </span>
                    {mode === 'parts' && (
                      <button
                        type="button"
                        className="part-row__add"
                        title="Thêm vào bộ trang phục đang tạo"
                        onClick={() => {
                          setMode('outfits');
                          ensureDetected();
                          addToPendingGroup(node.part.index);
                        }}
                      >
                        +
                      </button>
                    )}
                  </div>

                  {isExpanded &&
                    ownMeshes.map((mesh) => {
                      const meshHidden = hiddenDrawables.has(mesh.index);
                      return (
                        <div
                          key={mesh.id}
                          className={`mesh-row${meshHidden ? ' mesh-row--hidden' : ''}`}
                          style={{ paddingLeft: `${node.depth * 12 + 26}px` }}
                          title={mesh.id}
                        >
                          <label className="part-row__toggle">
                            <input
                              type="checkbox"
                              checked={!meshHidden}
                              onChange={() => toggleDrawableHidden(mesh.index)}
                            />
                          </label>
                          <span className="part-row__name">{mesh.id}</span>
                        </div>
                      );
                    })}
                </div>
              );
            })}
          </div>
          ) : (
            <div
              className="panel__scroll"
              onMouseLeave={() => runtimeRef.current?.setIsolatedDrawables(null)}
            >
              {filteredGroups.length === 0 && (
                <p className="panel__empty">Không có hình nào khớp.</p>
              )}

              {filteredGroups.map((group) => {
                const indices = group.drawables.map((drawable) => drawable.index);
                const hiddenCount = indices.filter((index) =>
                  hiddenDrawables.has(index)
                ).length;
                // A filtered view opens its groups: the user has already
                // narrowed the list, so making them click again is pure friction.
                const isOpen = openGroups.has(group.key) || filter.trim() !== '';

                return (
                  <section key={group.key} className="mesh-group">
                    <header
                      className="mesh-group__header"
                      onMouseEnter={() =>
                        runtimeRef.current?.setIsolatedDrawables(indices)
                      }
                    >
                      <button
                        type="button"
                        className="mesh-group__toggle"
                        onClick={() => toggleGroup(group.key)}
                      >
                        {isOpen ? '▾' : '▸'} {group.label}
                        <span className="part-row__count">
                          {group.drawables.length} hình
                          {hiddenCount > 0 && ` · ẩn ${hiddenCount}`}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="expr__action"
                        title={
                          hiddenCount === indices.length
                            ? 'Hiện lại cả nhóm'
                            : 'Ẩn cả nhóm'
                        }
                        onClick={() =>
                          setGroupHidden(indices, hiddenCount !== indices.length)
                        }
                      >
                        {hiddenCount === indices.length ? 'Hiện' : 'Ẩn'}
                      </button>
                    </header>

                    {isOpen &&
                      group.drawables.map((drawable) => {
                        const meshHidden = hiddenDrawables.has(drawable.index);
                        return (
                          <div
                            key={drawable.id}
                            className={`mesh-row${meshHidden ? ' mesh-row--hidden' : ''}`}
                            title={drawable.id}
                            onMouseEnter={() =>
                              runtimeRef.current?.setIsolatedDrawables([drawable.index])
                            }
                          >
                            <label className="part-row__toggle">
                              <input
                                type="checkbox"
                                checked={!meshHidden}
                                onChange={() => toggleDrawableHidden(drawable.index)}
                              />
                            </label>
                            <span className="part-row__name">{drawable.id}</span>
                          </div>
                        );
                      })}
                  </section>
                );
              })}
            </div>
          )}

          <p className="panel__hint">
            Ẩn ở đây chỉ để xem thử. Muốn lưu thành lựa chọn đổi được, hãy tạo một
            <strong> bộ trang phục</strong> ở tab bên cạnh.
          </p>
        </>
      ) : (
        <>
          {hasParts && (
            <p className="panel__hint">
              Một <strong>bộ</strong> gồm nhiều lựa chọn cho cùng vị trí — ví dụ đồng
              phục và váy dạ hội. Runtime chỉ hiện một lựa chọn mỗi lúc và tự chuyển
              mượt, nên người dùng cuối đổi được trang phục.
            </p>
          )}

          {/* An outfit the author already wired is worth far more than one the
              user rebuilds by hand: it is what the model was designed to do, and
              it works without editing the moc. Offered first for that reason. */}
          {outfitSwitches.length > 0 && (
            <section className="outfit-found">
              <h3 className="outfit-found__title">Bộ có sẵn trong model</h3>
              <p className="panel__hint">
                Tác giả model đã làm sẵn các lựa chọn này. Bật/tắt để xem thử trên
                model, rồi bấm “Lưu thành bộ” để ghi ra file exp3.json.
              </p>

              {outfitSwitches.map((parameter) => {
                const worn = wornSwitches.has(parameter.index);
                return (
                  <label key={parameter.id} className="outfit-row" title={parameter.id}>
                    <input
                      type="checkbox"
                      checked={worn}
                      onChange={() => toggleWorn(parameter)}
                    />
                    <span className="outfit-row__name">{parameter.name}</span>
                    <span className="part-row__count">
                      {parameter.shows.length + parameter.hides.length} hình
                    </span>
                  </label>
                );
              })}

              <p className="panel__hint">
                {/* Saying what gets written matters: the file turns the unticked
                    switches off too, which is what stops two outfits stacking. */}
                Bộ lưu ra sẽ bật {wornSwitches.size} lựa chọn đang tick và tắt
                {' '}
                {outfitSwitches.length - wornSwitches.size} lựa chọn còn lại.
              </p>

              <div className="pose__tools">
                <button
                  type="button"
                  className="button"
                  disabled={wornSwitches.size === 0}
                  onClick={handleSaveWorn}
                >
                  Lưu thành bộ
                </button>
                {wornSwitches.size > 0 && (
                  <button type="button" className="button button--ghost" onClick={resetWorn}>
                    Về mặc định
                  </button>
                )}
              </div>
            </section>
          )}

          {/* pose3.json addresses parts by id, so a model whose meshes belong to
              no part cannot express a group at all — the file would load and do
              nothing. Where the model has its own switches that path is not
              missed, so it is not worth a warning; where it has neither, the
              user needs to know what would fix it. */}
          {!hasParts && outfitSwitches.length === 0 && (
            <p className="panel__warn">
              Model này chưa gán hình vào part nào, mà bộ trang phục lại phải trỏ tới
              part — nên chưa tạo được ở đây. Cách xử lý: mở model trong Cubism Editor,
              gom các hình của từng bộ vào một part riêng rồi xuất lại. Trong lúc đó,
              tab “Ẩn / hiện phần” vẫn ẩn/hiện được từng hình để xem thử.
            </p>
          )}

          {/* Everything below builds a pose3.json, which addresses parts. On a
              model with none, these controls can only produce a file the runtime
              ignores, so they are not shown at all rather than shown disabled. */}
          {hasParts && (
            <>
            {posePath === null && pose.Groups.length === 0 && (
              <p className="panel__warn">
                Model chưa có file pose3.json. File sẽ được tạo khi bạn tạo bộ đầu tiên.
              </p>
            )}

            <label className="pose__fade">
              Thời gian chuyển (giây)
              <input
                type="number"
                min={0}
                max={3}
                step={0.1}
                value={pose.FadeInTime ?? 0.5}
                onChange={(event) => updateFade(Number(event.target.value))}
              />
            </label>

            <div className="panel__scroll">
              {pose.Groups.length === 0 && pendingGroup.length === 0 && (
                <p className="panel__empty">
                  Chưa có bộ nào. Bấm “Thêm lựa chọn” bên dưới để bắt đầu.
                </p>
              )}

              {pose.Groups.map((group, groupIndex) => (
                <section key={groupIndex} className="pose-group">
                  <header className="pose-group__header">
                    <h3>Bộ {groupIndex + 1}</h3>
                    <button
                      type="button"
                      className="expr__action expr__action--danger"
                      title="Xoá bộ này"
                      onClick={() => handleDeleteGroup(groupIndex)}
                    >
                      ✕
                    </button>
                  </header>
                  {group.map((member, memberIndex) => {
                    const part = info.parts.find((entry) => entry.id === member.Id);
                    return (
                      <div
                        key={member.Id}
                        className="pose-member"
                        onMouseEnter={() =>
                          part && runtimeRef.current?.setIsolatedPart(part.index)
                        }
                        onMouseLeave={() => runtimeRef.current?.setIsolatedPart(null)}
                      >
                        <button
                          type="button"
                          className="pose-member__show"
                          title="Hiện lựa chọn này, ẩn các lựa chọn khác"
                          onClick={() => handleShowMember(groupIndex, memberIndex)}
                        >
                          Hiện
                        </button>
                        <span className="pose-member__name" title={member.Id}>
                          {part?.name ?? member.Id}
                          {!part && <span className="expr-table__warn"> (không có trong moc)</span>}
                        </span>
                        <button
                          type="button"
                          className="expr__action expr__action--danger"
                          onClick={() => handleRemoveMember(groupIndex, memberIndex)}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </section>
              ))}

              <section className="pose-group pose-group--pending">
                <header className="pose-group__header">
                  <h3>Bộ mới</h3>
                  {pendingGroup.length > 0 && (
                    <button
                      type="button"
                      className="expr__action"
                      title="Bỏ hết"
                      onClick={() => setPendingGroup([])}
                    >
                      ✕
                    </button>
                  )}
                </header>

                {pendingGroup.length === 0 ? (
                  <p className="panel__hint">
                    Cần ít nhất 2 lựa chọn. Bấm nút bên dưới rồi bấm vào phần đó trên model.
                  </p>
                ) : (
                  pendingGroup.map((partIndex) => {
                    const part = partByIndex(partIndex);
                    return (
                      <div
                        key={partIndex}
                        className="pose-member"
                        onMouseEnter={() => runtimeRef.current?.setIsolatedPart(partIndex)}
                        onMouseLeave={() => runtimeRef.current?.setIsolatedPart(null)}
                      >
                        <span className="pose-member__name">{part?.name}</span>
                        <button
                          type="button"
                          className="expr__action expr__action--danger"
                          onClick={() =>
                            setPendingGroup((current) =>
                              current.filter((entry) => entry !== partIndex)
                            )
                          }
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })
                )}

                <div className="pose__tools">
                  {canvasMode === 'pickDrawable' ? (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={handleCancelPick}
                    >
                      Huỷ chọn
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      disabled={!hasParts}
                      onClick={() => startPickFromModel(addToPendingGroup)}
                    >
                      Thêm lựa chọn (bấm lên model)
                    </button>
                  )}
                  <button
                    type="button"
                    className="button"
                    disabled={!hasParts || pendingGroup.length < 2}
                    onClick={handleCreateGroup}
                  >
                    Tạo bộ ({pendingGroup.length})
                  </button>
                </div>
              </section>
            </div>
            </>
          )}
        </>
      )}
    </aside>
  );
}
