# Đóng góp

Tài liệu này dành cho người sửa code. Cách dùng app: [README.md](README.md).

## Chạy

```bash
npm install          # postinstall: sync Core + sinh .d.ts của framework
npm run dev
npm test             # unit test
npm run smoke        # test đầu-cuối trên file thật
npm run build        # typecheck 3 project + build production
```

Trước khi mở PR: `npm test && npm run build` phải xanh. `npm run smoke` nên chạy nếu bạn
đụng vào pipeline render, document store, hoặc phần xuất file.

## Kiến trúc

### Vì sao dùng CubismWebFramework gốc, không dùng pixi-live2d-display

`pixi-live2d-display` là **player**: ticker nội bộ tự chạy motion/blink/physics mỗi frame,
nên editor sẽ liên tục bị ghi đè giá trị slider. Framework chính chủ cho phép instantiate
từng subsystem độc lập (`CubismPhysics`, `CubismPose`, `CubismMotion`…) và **editor tự
quyết định thứ tự update** — đúng thứ một app chỉnh sửa cần.

### Pipeline mỗi frame ([EditorRuntime.ts](src/renderer/core/cubism/EditorRuntime.ts))

Thứ tự này là điểm cốt lõi của cả app:

```
loadParameters()              khôi phục base của frame trước
→ motion                      nếu đang phát hoặc scrub timeline
→ nhìn-theo-chuột (nếu bật)
→ biểu cảm đang bật           cộng lên dáng mà motion tạo ra
→ ghim tham số (pin)          giá trị người dùng đang giữ — luôn thắng
→ saveParameters()            ← chụp "authored pose" ở đây (dùng cho capture/ghi)
→ physics.evaluate()          tóc/trang phục phản ứng với vị trí vừa đặt
→ pose.updateParameters()
→ ẩn/hiện part                lệnh ẩn của người dùng thắng pose
→ model.update() → drawModel()
```

Mỗi subsystem được **dựng lại từ JSON đã sửa** (không mutate), nên preview luôn khớp chính
xác với file sẽ export.

### Mô hình document

Mỗi file JSON của model là một store (`createDocumentStore`). Mọi thay đổi đi qua
`edit(label, recipe, coalesceKey?)`: immer sinh patch, patch vào `CommandStack` (undo), rồi
document được đẩy sang autosave (debounce 2s, ghi atomic tmp + fsync + rename, backup xoay
vòng 10 bản/file).

Riêng biểu cảm là một document nhưng nhiều file `exp3.json`, nên nó đăng ký một *splitter*
với autosave để tách ra đúng các file trên đĩa.

**Quy tắc:** `features/*` không chạm `fs` hay class Cubism trực tiếp — chỉ đọc store và gọi
qua `runtimeRef`. `core/` sở hữu engine.

### Cấu trúc

```
src/
├─ shared/              types cho 8 định dạng file Live2D + hợp đồng IPC
├─ main/                file I/O, dialog (WorkspaceService = "không hỏng bản gốc")
├─ preload/             contextBridge — renderer không bao giờ chạm fs
└─ renderer/
   ├─ core/cubism/      CubismLoader, EditorRuntime, ModelInfo, ViewTransform,
   │                    HitTester (chọn mesh), OverlayRenderer (gizmo)
   ├─ core/motion/      MotionDocument (keyframe), MotionSerializer (⇄ motion3.json),
   │                    MotionEvaluator (parity CubismMotion), MotionPlayback
   ├─ document/         nguồn chân lý cho mọi editor:
   │                      createDocumentStore  1 store/1 file JSON, có undo + autosave
   │                      commands/            CommandStack (undo/redo toàn cục)
   │                      autosave.ts          debounce + ghi atomic qua IPC
   │                      loadSession.ts       nạp mọi document khi mở model
   │                      runtimeRef.ts        seam tới model native
   │                      testApi.ts           handle cho smoke test
   ├─ features/         1 folder mỗi panel
   └─ app/              shell, layout, tabs, styles
vendor/                 Cubism Core + Framework (xem THIRDPARTY.md)
scripts/                sync-core, smoke-test, ui-shots
```

### Vendor

`vendor/cubism-web-framework/` là source TypeScript của SDK Live2D (bản R5, commit
`d4da0aa`), **commit thẳng vào repo này** chứ không phải submodule. Lý do: submodule chỉ
lưu con trỏ, nên CI checkout ra thư mục rỗng và `npm ci` chết ngay ở postinstall khi
`sync-core.js` không tìm thấy `Shaders/WebGL`. Commit thẳng cũng là điều kiện để patch
được — vá vào submodule thì không commit được vào repo này.

Vendor thay vì dùng npm để có thể patch. **Mọi sửa đổi phải ghi vào `vendor/patches/`** và
re-apply sau khi nâng SDK, rồi chạy `npm run build:framework-types`.

Nâng SDK: tải bản mới từ [CubismWebFramework](https://github.com/Live2D/CubismWebFramework),
thay nội dung thư mục (giữ lại `tsconfig.emit.json` — file này của project, không phải của
SDK), re-apply patch, chạy `npm run build:framework-types`, rồi cập nhật số bản trong
[THIRDPARTY.md](THIRDPARTY.md).

## Năm cái bẫy đã gặp

Ghi lại vì đều mất thời gian tìm, và sẽ gặp lại khi nâng SDK hoặc mở model lạ.

**1. `Live2DCubismCore is not defined`.** Core là script UMD gán vào `window`, còn framework
đọc biến toàn cục `Live2DCubismCore` ngay ở module scope (enum khởi tạo từ hằng số của Core).
Import nó từ bundle sẽ đặt vào module scope → framework không thấy. Cách đúng: load bằng
`<script>` thường trong [index.html](src/renderer/index.html), **trước** bundle module.
`scripts/sync-core.js` copy file vào public dir.

**2. Shader fetch thất bại.** Từ Cubism 5 R5, framework tách GLSL ra file `.vert`/`.frag`
rời và fetch lúc runtime, mặc định theo layout của SDK samples
(`../../Framework/Shaders/WebGL/`). Phải copy shaders vào public dir và truyền `shaderPath`
vào **mỗi lần** `drawModel()`. Path phải resolve theo `document.baseURI`, không dùng
`/shaders/` root-absolute, vì bản đóng gói load `index.html` qua `file://`.

**3. Framework không typecheck được ở strict mode.** Nó viết cho config lỏng hơn (trả `null`
cho kiểu object khắp nơi, thiếu `override`). Giải pháp: framework được compile ra `.d.ts`
riêng (`npm run build:framework-types`), app strict chỉ thấy declarations; Vite vẫn bundle
source thật để giữ khả năng patch. Framework typecheck riêng qua `tsconfig.vendor.json`.

**4. Texture compositor ra ảnh rỗng.** Do **lật dọc hai lần**: shader đã lật, rồi
`readPixels` lật lại. Không đảo hàng sau `readPixels`.

**5. `ELECTRON_RUN_AS_NODE` đặt rỗng vẫn có tác dụng.** Electron chỉ kiểm tra biến có tồn
tại hay không, nên `ELECTRON_RUN_AS_NODE= npx electron ...` vẫn crash. Phải `unset` hẳn.
Các script trong `scripts/` đã tự `delete env.ELECTRON_RUN_AS_NODE` cho tiến trình con.

## Quy ước code

- **Comment giải thích *vì sao*, không phải *cái gì*.** Code đã nói nó làm gì; comment nên
  ghi lại quyết định, đánh đổi, hoặc cái bẫy mà người đọc sau sẽ vấp phải.
- Không thêm dependency nếu chưa thực sự cần — app cố ý giữ ít phụ thuộc.
- Test đi kèm thay đổi hành vi. Logic thuần (parser, serializer, phân nhóm…) tách khỏi
  React để test được không cần DOM.
- Không commit file sinh tự động (`out/`, `dist/`, `vendor/*/dist/`, `src/renderer/public/`)
  — đã có trong `.gitignore`.

## Kiểm thử với model thật

Unit test không bắt được lỗi format. Khi đụng vào phần đọc/ghi file Live2D, hãy thử với ít
nhất một model **không phải Hiyori** — đặc biệt là model moc3 v2 (Cubism 3.0), vì chúng
thiếu những thứ mà model mới luôn có (part assignment, cdi3 đầy đủ, pose3).
