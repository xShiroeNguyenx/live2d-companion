# Roadmap

Trạng thái từng mảng và thứ tự làm tiếp. Thiết kế chi tiết ở [PLAN.md](PLAN.md).

Không có ngày tháng ở đây — đây là dự án cá nhân, thứ tự phản ánh cái gì chặn cái gì chứ
không phải cam kết thời gian.

## Đã xong

### Nền tảng
- Import bằng chọn thư mục, kéo-thả, hoặc model mẫu Hiyori
- Copy-on-import: bản gốc chỉ đọc, làm việc trên `original/` + `working/` trong workspace
- Render CubismWebFramework + WebGL2, tự fit khung không méo
- Zoom theo con trỏ, pan, fit (nháy đúp)
- Panel tham số sinh từ moc: min/max/default đúng, tên từ `cdi3.json`, nhóm theo
  ParameterGroups, badge BlendShape (Cubism 5)
- Ghim tham số — giá trị người dùng thắng physics/motion trong pipeline
- Bật/tắt biểu cảm, physics, pose, nhìn-theo-chuột

### Sửa và lưu
- Undo/redo toàn cục (Ctrl+Z / Ctrl+Shift+Z) bằng immer patches; một lần kéo slider gộp
  thành một bước
- Autosave debounce 2s, ghi atomic, backup xoay vòng 10 bản/file; Ctrl+S ghi ngay
- Editor biểu cảm: lưu dáng hiện tại, bật nhiều cái cùng lúc để soi xung đột, sửa bảng
  tham số / fade / nhân bản / xoá — đồng bộ vào `model3.json`
- Editor trang phục (pose3): nhóm bật/tắt từ part, xem thử, tạo `pose3.json` nếu thiếu
- Editor cấu hình: vùng chạm (bấm lên model để chọn, có chế độ thử theo luật hộp-bao của
  runtime), nhóm EyeBlink/LipSync có gợi ý, bảng tên hiển thị cdi3
- Xuất + kiểm tra: đối chiếu mọi id trong JSON với moc thật, kiểm Meta counts của physics,
  cảnh báo texture không phải luỹ thừa của 2 và thiếu nhóm Idle/EyeBlink/LipSync

### Cử động
- Engine motion đã kiểm chứng parity với `CubismMotion` thật: >500 điểm/motion, sai số
  < 1e-4, cả 2 chế độ bezier. Round-trip trả `Segments` giống hệt từng số
- Timeline dope-sheet vẽ bằng canvas (chịu được 30–100 track), keyframe hiện hình theo kiểu
  nội suy, kéo/thêm/chọn nhiều/đổi kiểu/xoá
- Transport: phát, lặp, tốc độ 0.25–2×, scrub
- Ghi từ slider: ghim tham số rồi kéo trong lúc phát, chỉ tham số đang ghim được ghi
- Đồ thị bezier: kéo keyframe và tay nắm, tay nắm tự kẹp trong đoạn

### Rung lắc
- Chế độ đơn giản (2 slider) ánh xạ xuống mobility/delay/scale thật; chế độ nâng cao mở
  bảng input/output/đốt như format gốc
- Bàn thử: nút lắc, slider gió, vẽ con lắc của chuỗi đang chọn ngay trên model
- Đọc particle từ `_physicsRig` (field public) nên không cần patch framework

### Model không có part
- Phát hiện model không gán mesh vào part (thường gặp ở moc3 v2 / Cubism 3.0)
- Liệt kê mesh trực tiếp, gom theo tiền tố tên nếu có, không thì theo vùng thân — cắt theo
  số lượng mesh chứ không theo chiều cao
- Tự dò tham số đổi đồ tác giả làm sẵn (đo số mesh bật/tắt khi kéo 0→1, không dựa vào tên)
- Lưu lựa chọn thành `exp3.json` chuẩn, đăng ký vào `model3.json`

### Màu sắc
- Chọn vùng bằng cách bấm lên model, rasterize UV của mesh thành mask
- Lớp đổi màu (hue/tươi/sáng/đổi hẳn) và lớp vẽ tay, không phá ảnh gốc

## Đang làm

- **Hoàn thiện editor texture** — cọ vẽ tử tế (kích thước, độ mềm, tẩy), đổi màu theo vùng
  chọn nhiều mảnh

## Tiếp theo

Thứ tự ưu tiên:

1. **Đóng gói installer** — `npm run package` đã có config nhưng chưa build/ký thử. Đây là
   thứ chặn việc phát hành bản dùng được cho người không biết build.
2. **Âm thanh + lip-sync preview** — nạp file audio, xem miệng khớp theo `ParamMouthOpenY`
3. **Web-embed generator** — sinh snippet pixi-live2d-display để nhúng model đã sửa vào web

## Nợ kỹ thuật

- **Smoke test còn flaky (~1/8 lần), ở nhiều bước.** Đã thấy hai kiểu fail: capture biểu
  cảm đọc được dáng mặc định thay vì dáng vừa pose, và seek motion không làm đổi giá trị
  tham số. Cả hai đều tự pass khi chạy lại. Điểm chung là driver giả định một thao tác đã
  có hiệu lực sau một khoảng chờ cố định, trong khi render loop chưa chắc đã chạy frame
  nào. Đã thu hẹp bằng cách chờ theo điều kiện ở bước capture và bằng việc
  `probeOpacities` khôi phục cả hai buffer tham số, nhưng các bước khác vẫn chờ mù. CI
  chạy lại một lần trước khi báo đỏ. **Phải sửa dứt điểm trước khi tin vào CI như một cổng
  chất lượng.**
- **`electron-updater` đang là dependency nhưng không dùng ở đâu** (`grep` trong `src/`
  không ra kết quả nào). Nó kéo `google-auth-library` và `protobufjs` vào bản đóng gói.
  Gỡ đi, hoặc thực sự nối tính năng tự cập nhật.
- Chưa có icon ứng dụng — bản đóng gói dùng icon mặc định của Electron.
- Installer chưa ký số, Windows SmartScreen sẽ cảnh báo ở lần chạy đầu.

## Đang cân nhắc

Chưa quyết, ghi lại để không quên:

- Dockable tabs (flexlayout-react) thay panel cố định hiện tại
- Đóng gói macOS/Linux — hiện chỉ nhắm Windows
- Sửa `userdata3.json`
- Xem trước đồng thời nhiều model

## Ngoài phạm vi

- **Sửa mesh, deformer, artwork, hay định nghĩa tham số.** `.moc3` là binary biên dịch từ
  `.cmo3` độc quyền — không có cách nào sửa mà không có Cubism Editor. App này chỉ sửa file
  runtime và thao tác tham số.
- **Model Cubism 2 (`.moc`)** — bị từ chối lúc import kèm thông báo rõ ràng.
- **Tạo model từ ảnh** — đã tách sang project riêng
  [live2d-from-image](../live2d-from-image), vì pipeline sinh model và editor sửa model có
  vòng đời, dependency và người dùng khác nhau.
