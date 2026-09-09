# PLAN — Live2D Companion Studio

> App desktop chỉnh sửa model Live2D có sẵn, thao tác 100% qua giao diện — không cần code, không cần Live2D Cubism Editor.

## 1. Bối cảnh & mục tiêu

Người dùng có model Live2D tải về/mua sẵn (thư mục runtime `.moc3` + JSON + texture) và muốn tùy biến mọi thứ có thể: cử động (motion), độ rung lắc tóc/trang phục (physics), biểu cảm (expression), bật/tắt trang phục (pose), đổi màu/vẽ thêm lên trang phục (texture), hit area, lip-sync… — tất cả bằng chuột trên GUI.

**Quyết định đã chốt:**

| Hạng mục | Quyết định |
|---|---|
| Nền tảng | Electron desktop app (Windows 11 chính) |
| Phạm vi | Full runtime editing: motion timeline, physics, expression, pose/outfit, texture recolor/paint, hit areas, lip-sync, param sliders |
| Mục đích xuất | Companion app (tương thích anime-companion-vscode), VTuber (VTube Studio), Web embed |

## 2. Ràng buộc kỹ thuật đã xác minh

- `.moc3` là binary biên dịch từ `.cmo3` (độc quyền Live2D) → **không sửa được mesh/deformer/artwork/định nghĩa parameter**. App chỉ sửa các file runtime: `model3.json`, `motion3.json`, `physics3.json`, `exp3.json`, `pose3.json`, `cdi3.json`, `userdata3.json`, texture PNG + thao tác parameter real-time.
- Cubism 5 SDK for Web R5 (02/2026): Core proprietary nhưng được redistribute; CubismWebFramework theo Live2D Open Software License (được vendor + sửa nguồn). Ship sản phẩm cần Publication License (miễn phí dưới ngưỡng doanh thu).
- Cubism 5 Core load được mọi moc3 (3.0 → 5.3) → một runtime là đủ. Cubism 2 (`.moc`) từ chối import với thông báo rõ ràng.
- `anime-companion-vscode` dùng pixi-live2d-display (cubism4) + Cubism Core + PIXI.js → export phải là thư mục runtime chuẩn để stack này load được.

## 3. Kiến trúc — quyết định quan trọng nhất

### Dùng CubismWebFramework gốc (vendored), KHÔNG dùng pixi-live2d-display cho editor

- pixi-live2d-display là **player**: ticker nội bộ tự chạy motion/blink/physics mỗi frame → editor phải "đánh nhau" với nó (slider bị ghi đè liên tục); bản gốc đóng băng ở 0.4.0, Cubism 5 chỉ có ở fork cộng đồng.
- CubismWebFramework cho **quyền điều khiển thấp cấp** editor cần: `setParameterValueById`, `saveParameters/loadParameters`, đọc toàn bộ params/parts/drawables từ Core API (`model.parameters.ids/minimumValues/maximumValues/defaultValues`, `model.drawables.vertexUvs/indices/renderOrders`…), từng subsystem (`CubismPhysics`, `CubismMotion`, `CubismPose`, `CubismExpressionMotion`, `CubismEyeBlink`, `CubismRenderer_WebGL`) instantiate độc lập → **vòng update do editor tự quyết định thứ tự**.
- Không cần PixiJS trong editor: render bằng `CubismRenderer_WebGL`, gizmo (hit area, physics, highlight) vẽ trên Canvas2D overlay chung view matrix. PixiJS chỉ xuất hiện trong snippet web-embed sinh ra cho user.

### Stack đầy đủ

| Thành phần | Lựa chọn |
|---|---|
| Shell | Electron ~43.x, `contextIsolation: true`, sandbox renderer |
| Build | electron-vite (Vite 7) + electron-builder 26.x (NSIS installer) |
| Ngôn ngữ | TypeScript 5 strict, types chia sẻ main/preload/renderer |
| UI | React 19 + react-resizable-panels (MVP) → flexlayout-react (v1, dockable tabs) |
| State | Zustand v5; undo/redo bằng immer v10 `produceWithPatches` + Command stack |
| Validation | Ajv v8 + JSON Schema tự viết cho 8 loại file |
| Live2D | Cubism 5 SDK for Web R5: `live2dcubismcore.min.js` + CubismWebFramework vendored trong `vendor/` |
| File watch | chokidar v4 (main process) — hot-reload texture sửa ngoài |
| Ảnh | sharp (main: thumbnail/downscale); WebGL shader (renderer: HSL) |
| Audio | Web Audio API (waveform + lip-sync preview) |
| Test | Vitest (unit: curve evaluator, serializer, schema) + Playwright (E2E smoke) |

### Phân chia process

- **Main:** toàn bộ file I/O (copy-on-import, atomic write, backup), dialog, chokidar, mở external editor. Renderer gọi qua `contextBridge` typed API — không bao giờ `fs` trực tiếp trong renderer.
- **Renderer:** Cubism runtime, mọi panel, document stores, undo/redo, texture compositing (OffscreenCanvas/WebGL).

## 4. Cấu trúc thư mục

```
live2d-companion/
├─ vendor/
│  ├─ live2dcubismcore/          # Core JS + license notice
│  └─ cubism-web-framework/      # framework vendored + patches/ (log các sửa đổi)
├─ resources/                    # icon, model mẫu first-run
├─ src/
│  ├─ shared/                    # types (Model3Json, Motion3Json…), schemas/ (Ajv), ipc-contract.ts
│  ├─ main/
│  │  ├─ services/               # WorkspaceService, FileWatchService, ExportService, ThumbnailService
│  │  └─ ipc/
│  ├─ preload/index.ts
│  └─ renderer/
│     ├─ core/                   # engine layer (không UI)
│     │  ├─ cubism/              # CubismLoader, EditorRuntime, ModelInfo, HitTester, OverlayRenderer
│     │  ├─ motion/              # MotionDocument, MotionEvaluator, MotionSerializer, RecordingSampler
│     │  ├─ physics/PhysicsSerializer.ts
│     │  └─ texture/             # TextureCompositor, RegionMasker
│     ├─ document/               # ModelSession, stores/, commands/ (CommandStack), autosave.ts
│     ├─ features/               # 1 folder / panel: explorer, preview, parameters, motion-editor,
│     │                          #   physics-editor, expression-editor, pose-editor,
│     │                          #   texture-editor, model-config, export
│     └─ app/                    # layout, menu, shortcuts, theme
└─ tests/                        # unit/ + fixtures/ (model mẫu Live2D: Hiyori, Mao…)
```

Quy tắc: `features/*` không đụng `fs` hay class Cubism trực tiếp — chỉ dispatch command vào `document/` và đọc store; `core/` sở hữu engine.

## 5. Thiết kế từng tính năng (panel)

### 5.1. Model Explorer + Import
- Kéo-thả folder model (hoặc `.model3.json`): parse `FileReferences`, kiểm tra file tồn tại, **copy-on-import** vào workspace `Documents/Live2DCompanion/workspaces/<tên>-<hash8>/` gồm `original/` (nguyên bản, read-only), `working/` (bản sửa), `.l2dproj.json`, `.backups/`, `.layers/`.
- Load bằng `CubismMoc.create(buffer, true)` (bật moc consistency check); kiểm tra version bằng `csmGetMocVersion`; từ chối Cubism 2 với thông báo thân thiện.
- Panel cây asset: thông tin moc (version, số param/part/drawable, canvas size), texture thumbnails, motion theo group, expressions, physics, pose. Tên hiển thị lấy từ `cdi3.json` nếu có. Màn hình home: model gần đây + thumbnail.

### 5.2. Preview Canvas + Parameter Panel
- Canvas WebGL chạy `EditorRuntime` 60fps + Canvas2D overlay gizmo; zoom theo con trỏ, pan (space/middle-drag), nút fit/100%; background: màu / caro / ảnh (kiểm tra green-screen VTuber).
- Slider tự sinh từ Core (min/max/default), nhóm theo `cdi3` ParameterGroups, tìm kiếm; badge cho param BlendShape (Cubism 5). **Pin** per-slider: giá trị pin thành "authoring override" thắng physics/motion trong pipeline. Tab riêng cho part opacity.
- Toggle toolbar: physics, eye-blink, breath, mouse-follow (map `ParamAngleX/Y/Z`, `ParamEyeBallX/Y`).

### 5.3. Motion Timeline Editor (panel chủ lực, khó nhất)
- **Xử lý format motion3.json:** `Segments` là mảng số phẳng — điểm đầu `(t0,v0)` rồi các record theo type id: `0` linear (2 số), `1` bezier (6 số), `2` stepped (2), `3` inverse-stepped (2). Nội bộ chuyển thành `Keyframe {time, value, outSegment}` mỗi track; serialize ngược khi lưu. **Meta counts (`CurveCount`, `TotalSegmentCount`, `TotalPointCount`) phải tính lại mỗi lần lưu** — sai counts làm crash loader bên thứ ba → logic nằm trong `MotionSerializer` + round-trip test.
- **Parity bezier:** luôn ràng buộc handle như Cubism Editor (clamp trong segment, mặc định 1/3–2/3) và luôn ghi `AreBeziersRestricted: true` → WYSIWYG trên framework, pixi-live2d-display lẫn VTube Studio. `MotionEvaluator` tự cài đặt evaluation parametric restricted, **parity-test với `CubismMotion`** trên fixture (sample N điểm, sai số < 1e-4).
- UI: danh sách track trái (+track chọn param/part-opacity bất kỳ, hỗ trợ `Target:"Model"`); giữa là timeline vẽ canvas (virtualized, 100+ track), 2 chế độ **dope sheet** (diamond, box-select, drag, copy/paste, snap Fps) và **curve view** (kéo key + bezier handle, đổi loại segment per-key); transport bar, loop, scrub playhead (evaluator áp thẳng `setParameterValueById` → seek tức thì, physics chạy live bên trên khi play).
- **Record-from-sliders:** bấm record → kéo slider/mouse-follow → sample 30Hz → rút gọn Ramer-Douglas-Peucker thành keyframe. Đây là cách người không biết animation "diễn" cho model.
- Âm thanh: gán wav/mp3 (copy vào workspace), dải waveform dưới ruler, playback đồng bộ, ghi `Sound` vào model3. UserData events = marker trên ruler. Fade motion-level + per-curve.
- Thư viện motion: group từ model3 (`Idle`, `TapBody`…), thêm/nhân bản/xóa/kéo đổi group.

### 5.4. Physics Editor (rung tóc / trang phục)
- Xử lý đủ `physics3.json`: `PhysicsSettings[]` với `Input[]` (source param, X/Y/Angle, weight, reflect), `Output[]` (param đích, vertexIndex, scale, weight), `Vertices[]` (position, mobility, delay, acceleration, radius), `Normalization`; `Meta.EffectiveForces` (gravity/wind) + `PhysicsDictionary` (tên chain).
- Trái: danh sách chain; giữa: **overlay vẽ pendulum** của chain đang chọn (framework không public vị trí particle → vendor framework và thêm accessor nhỏ vào `CubismPhysics` expose `_physicsRig.particles`, ghi log trong `vendor/patches/` — hợp lệ theo Open Software License); phải: bảng inputs/outputs/vertices/normalization.
- **Test rig:** slider gió (`physics.setOptions({wind})`), preset gravity, nút "shake" (sine có kịch bản), kéo chuột lắc đầu — kiểu "túm tóc lắc thử" kinh điển.
- Mỗi edit → serialize → rebuild `CubismPhysics.create()` + `stabilization(model)` (<1ms). **Simple mode** cho người không kỹ thuật: slider macro per-chain ("độ cứng" → mobility/delay, "độ lắc" → output scale), disclosure "Advanced" mở bảng raw.

### 5.5. Expression Editor
- Format `exp3.json`: `Parameters: [{Id, Value, Blend: Add|Multiply|Overwrite}]` + fade.
- **Capture mode:** chỉnh slider tạo dáng → "Capture as expression" → diff với default, chỉ ghi param thay đổi, mặc định `Blend:"Add"` với `Value = hiện tại − default` (khớp hành vi Cubism Editor), có switch per-row.
- Bảng chỉnh trực tiếp (param picker, kéo giá trị, dropdown blend) preview tức thì qua `CubismExpressionMotionManager`; **blend preview** bật nhiều expression cùng lúc để test xung đột (giống VTube Studio stack). Đồng bộ danh sách với model3 `FileReferences.Expressions` qua 1 command.

### 5.6. Pose / Outfit Editor (bật tắt trang phục)
- Format `pose3.json`: `Groups` = các radio group part (1 hiện, còn lại ẩn, cross-fade khi đổi; `Link` parts đi theo).
- UI: group dạng card (đặt tên trong project manifest — pose3 không chứa tên), mỗi card là radio các part (tên cdi3), click preview qua `CubismPose.updateParameters`. Tạo group: multi-select part từ cây (highlight live trên canvas qua `parentPartIndices`) → "Group as toggle". Kéo part vào member để tạo Link.
- Banner giáo dục: "Ẩn/hiện part ở đây mới là trang phục bật/tắt được — chỉnh opacity bằng slider ở Preview chỉ tạm thời" (chặn nhầm lẫn số 1 của user).

### 5.7. Texture Editor (đổi màu / vẽ thêm trang phục)

> **User đã xác nhận (2026-09-04):** cần mức đầy đủ — đổi màu theo vùng **và** cọ vẽ để
> thêm hoạ tiết/logo. Không rút gọn xuống chỉ HSL toàn ảnh.
- Layer stack non-destructive per texture, lưu `.layers/`, flatten PNG ghi vào `working/` mỗi lần apply.
- **Chọn vùng theo UV mask:** rasterize UV triangles (`vertexUvs` + `indices` từ Core) của part/drawable thành mask trên texture — click vào model (point-in-triangle, topmost theo `renderOrders`) hoặc chọn từ cây part → "cái áo khoác" thành vùng chọn. Đây là tính năng khiến người không biết vẽ vẫn đổi màu được.
- **Layer HSL/recolor:** hue/saturation/lightness/colorize trong mask bằng WebGL fragment shader (OffscreenCanvas), nhiều adjustment layer, reorder/toggle. **Layer paint:** brush cơ bản (size, hardness, opacity, eraser), vẽ trên texture-space (kèm UV wireframe) hoặc trực tiếp trên model (map ngược screen→UV). Mục tiêu "vẽ trái tim lên má", không cạnh tranh Photoshop.
- Preview model cập nhật live (`texSubImage2D`, debounce ~100ms). **Sửa ngoài:** "Edit in external app" → flatten → `shell.openPath` → chokidar watch → reload + toast.
- Undo bitmap riêng: tile snapshot 256px per-stroke, cap ~200MB evict cũ nhất; adjustment layer là parametric nên undo như JSON command thường.

### 5.8. Model Config Editor
- **Hit areas** (`HitAreas: [{Id, Name}]`, Id là drawable): "vẽ" hit area = chọn drawable có sẵn — hover highlight bounds, click gán, đặt tên; test mode click canvas xem area nào ăn (bounding-box như `CubismModel::isHit`).
- **EyeBlink/LipSync groups** (model3 `Groups`): dual picker, heuristic điền sẵn (`ParamEyeLOpen/ROpen`, `ParamMouthOpenY`); test blink qua `CubismEyeBlink`, test lip-sync bằng mic hoặc file audio (RMS → `ParamMouthOpenY`) — đúng cách companion app/VTS chạy.
- **cdi3.json:** bảng sửa tên hiển thị Parameters/ParameterGroups/Parts, đổi là mọi panel re-label; tạo mới nếu model thiếu. **userdata3.json:** bảng key/value (advanced). Mapping motion group: group nào là `Idle` (auto-play), wiring hit-area→motion.

### 5.9. Export / Packaging
- **Validation pass (blocking):** Ajv schema mọi JSON + semantic: mọi Id param/part/drawable tồn tại trong moc, mọi `FileReferences` path tồn tại, Meta counts motion/physics đúng, moc consistency, cảnh báo texture non-power-of-two. Kết quả dạng checklist fix-it.
- Export: copy `working/` → folder user chọn (loại file riêng của app: `.l2dproj.json`, `.layers/`, `.backups/`); tùy chọn zip. **Không bao giờ ghi đè folder nguồn** trừ khi user xác nhận tường minh.
- **VTube Studio:** VTS ăn folder model3 chuẩn, tự sinh `.vtube.json` — checklist cảnh báo (có group Idle, expressions khai trong model3, có physics, `Fps` trong physics Meta).
- **Web embed generator:** sinh `index.html` + snippet pixi-live2d-display (Cubism 4 CDN) cho moc3 ≤ 4.x, hoặc fork Cubism 5 (`pixi-live2d5` / `@naari3/pixi-live2d-display`) khi `csmGetMocVersion` ≥ 5, kèm notice Live2D bắt buộc; copy-to-clipboard.

## 6. Data flow, undo/redo, an toàn dữ liệu

### ModelSession + EditorRuntime (pipeline per-frame quyết định tất cả)
`ModelSession` (singleton per model) giữ: moc buffer, `CubismModel`, `ModelInfo`, GPU textures, 1 Zustand store per document + UI stores. Panel là view thuần trên store. `EditorRuntime` chạy pipeline thứ tự cố định:

```
loadParameters()                       // khôi phục base
→ motion evaluation (play/scrub)
→ active expressions
→ authoring overrides (slider pin — luôn thắng)
→ eye blink / breath (nếu bật)
→ physics.evaluate(model, dt)
→ pose.updateParameters(model, dt)
→ saveParameters() → model.update() → renderer.drawModel()
```

Store đổi → rebuild subsystem tương ứng từ JSON (debounce ~150ms, rebuild vài ms) → **preview luôn đúng 100% với file sẽ export**, không drift.

### Command + undo/redo
- Mọi mutation là Command `{label, scope, patches, inversePatches, coalesceKey}` từ immer `produceWithPatches`; **1 CommandStack toàn cục** (Ctrl+Z xuyên panel — ít gây bất ngờ nhất), cap ~200; `coalesceKey` gộp gesture kéo liên tục thành 1 entry.
- Bitmap dùng tile-snapshot song song nhưng đăng ký vào cùng stack để thứ tự nhất quán.

### Không bao giờ hỏng model gốc
- **Folder gốc trên đĩa không bao giờ bị ghi.** Import là copy; `original/` trong workspace là bản pristine thứ hai (read-only); luôn có "Revert to original" per-file và toàn model.
- **Autosave:** store dirty → IPC → main **ghi atomic** (tmp + fsync + rename), debounce 2s. **Backup:** trước mỗi lần ghi đè, bản cũ xoay vào `.backups/<file>/<timestamp>.json`, giữ 10 bản/file + pin theo ngày; texture giữ 3 bản.

## 7. Roadmap (solo dev, ~24 tuần, mỗi phase đều ship được)

**Phase 0 — Nền móng (tuần 1–2):** scaffold electron-vite + React + TS; vendor Core/Framework; render model mẫu (Hiyori) + zoom/pan; IPC skeleton; WorkspaceService copy-on-import + atomic write. *Milestone: mở moc3 bất kỳ, thấy model, kéo slider đọc từ Core.*

**Phase 1 — MVP "Customizer" (tuần 3–8):** explorer + import UX (1t); parameter panel + pin + runtime pipeline + toggle physics/blink (1t); command stack + autosave/backup (1t); **expression editor** (1t); **pose/outfit editor** (1t); model config + validation + export (1t). *Ship: "tùy biến biểu cảm, trang phục, setup VTube Studio — không cần code."*

**Phase 2 — v1 "Animator" (tuần 9–17):** motion document + serializer + evaluator parity-tested (2t); timeline dope sheet + playback (2t); curve editor bezier (1.5t); record-from-sliders + RDP (1t); sound strip + lip-sync config (1t); **physics editor** + patch accessor + test rig (1.5t). *Ship: authoring motion + physics đầy đủ.*

**Phase 3 — v2 "Studio" (tuần 18–24):** texture editor — region mask + HSL layer (2t), paint + bitmap undo (1.5t), hot-reload sửa ngoài (0.5t); web-embed generator + VTS checklist (1t); polish: i18n (EN/VI), onboarding tour, auto-update, ký installer (2t).

## 8. Rủi ro & giảm thiểu

1. **License Cubism Core khi ship Electron app:** cần Publication License khi phát hành (miễn phí dưới ngưỡng doanh thu nhỏ); bundle notice trong About + installer; Core giữ nguyên không sửa trong `vendor/`; **đọc kỹ điều khoản "competing product"** — app chỉ sửa file runtime, không đụng `.cmo3/.can3`, nhưng motion timeline trùng khái niệm với Animator của Cubism Editor → nếu mơ hồ, email Live2D licensing ngay trong Phase 1 (bảo hiểm rẻ).
2. **Cubism 2 vs 3/4/5:** từ chối `.moc` Cubism 2 (core cũ không được bundle hợp pháp) với thông báo rõ; gate feature theo `csmGetMocVersion` (blendshape/repeat chỉ ≥5.x); chọn snippet embed đúng version.
3. **Bezier motion3.json:** sai evaluation là mất WYSIWYG âm thầm, sai Meta counts là crash loader ngoài → policy restricted-handles + `AreBeziersRestricted: true` luôn; parity test vs `CubismMotion`; round-trip test serializer; tính lại Meta mỗi save; fixture từ model mẫu miễn phí của Live2D.
4. **Texture lớn / RAM:** model thương mại 2–4 texture 4096² → preview chạy bản downscale 2048 (toggle full-res); chỉ texture đang sửa giữ layer stack full-res; kỷ luật `ImageBitmap.close()`; cap bộ nhớ undo bitmap; cảnh báo khi vượt.
5. **Lệch hành vi giữa runtime (VTS, fork pixi):** preview dùng framework chính chủ (reference implementation); export JSON spec-strict (không key riêng của app); ma trận test tương thích thủ công mỗi release (VTube Studio, pixi-live2d-display, Cubism Viewer) với 3 model mẫu.
6. **Vẽ physics cần internals framework:** giải quyết bằng vendor + patch accessor ~10 dòng (ghi trong `vendor/patches/`, hợp lệ Open Software License); mỗi lần nâng SDK re-apply patch.

## 9. 5 file xương sống (mọi thứ khác treo vào đây)

- `src/renderer/core/cubism/EditorRuntime.ts` — pipeline per-frame mọi panel preview qua
- `src/renderer/document/ModelSession.ts` — nguồn chân lý duy nhất: moc + runtime + mọi JSON store
- `src/renderer/core/motion/MotionSerializer.ts` — keyframe ⇄ segments phẳng + tính lại Meta (rủi ro đúng-sai cao nhất)
- `src/main/services/WorkspaceService.ts` — copy-on-import, atomic write, backup ("không bao giờ hỏng bản gốc")
- `src/renderer/document/commands/CommandStack.ts` — undo/redo immer-patch dùng chung mọi panel

## 10. Verification (kiểm chứng theo phase)

- **Phase 0:** `npm run dev` mở app, kéo-thả model mẫu Hiyori → render + slider hoạt động.
- **Phase 1:** sửa expression/pose → export → load folder xuất bằng pixi-live2d-display (stack của anime-companion-vscode) và VTube Studio → hiển thị đúng.
- **Phase 2:** `vitest run` — parity test MotionEvaluator vs CubismMotion (ε < 1e-4), round-trip test MotionSerializer; motion tự tạo phát đúng trong VTS.
- **Phase 3:** đổi màu áo bằng HSL layer → export → texture mới hiển thị đúng trên cả 3 runtime đích.

## 11. Phase 4 — “Tạo từ ảnh” → đã tách sang project riêng

Pipeline "1 ảnh anime → model Live2D" giờ là project riêng:
[../live2d-from-image](../live2d-from-image). Bản ghi thiết kế đầy đủ của nó (vốn là mục này)
nằm ở [../live2d-from-image/PLAN.md](../live2d-from-image/PLAN.md).

Lý do tách: pipeline sinh model và editor sửa model có vòng đời, dependency (Gemini, ag-psd,
xử lý raster) và người dùng khác nhau; app này chỉ cần lo model **đã có**.

---

*Nguồn tham khảo: [Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) · [CubismWebFramework](https://github.com/Live2D/CubismWebFramework) · [SDK Release License](https://www.live2d.com/en/sdk/license/) · [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) · [pixi-live2d5 (Cubism 5 fork)](https://github.com/omniwaifu/pixi-live2d5)*
