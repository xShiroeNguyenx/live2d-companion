# Live2D Companion Studio

Chỉnh sửa **model Live2D có sẵn** bằng giao diện — không cần viết code, không cần Live2D
Cubism Editor.

Mở một model `.model3.json`, sửa biểu cảm / trang phục / cử động / rung lắc / màu sắc,
rồi xuất ra thư mục Live2D chuẩn dùng được với mọi runtime (VTube Studio, pixi-live2d-display,
Unity, app tự viết…).

> **Trạng thái: alpha.** Phần lõi chạy được và có test, nhưng chưa có bản cài đặt sẵn —
> hiện phải build từ source. Xem [ROADMAP.md](ROADMAP.md).

## Làm được gì

| | |
|---|---|
| 🎭 **Biểu cảm** | Pose model bằng slider rồi bấm lưu — app chỉ ghi tham số đã đổi. Bật nhiều biểu cảm cùng lúc để phát hiện xung đột tham số. |
| 👗 **Trang phục** | Ẩn/hiện từng part hoặc từng mesh, gom thành bộ đổi được. Model không có part vẫn dùng được (xem bên dưới). |
| 🎬 **Cử động** | Timeline dope-sheet + đồ thị bezier. Ghi motion bằng cách kéo slider trong lúc phát. |
| 🍃 **Rung lắc** | Chế độ đơn giản 2 slider, hoặc bảng physics đầy đủ. Có bàn thử vẽ con lắc ngay trên model. |
| 🎨 **Màu sắc** | Chọn vùng bằng cách bấm lên model (theo UV của mesh, không lem sang vùng khác), đổi màu hoặc vẽ tay. |
| ✅ **Kiểm tra + xuất** | Đối chiếu mọi id trong JSON với moc thật trước khi xuất — id sai bị runtime bỏ qua âm thầm, đây là lỗi khó phát hiện nhất. |

**Không phá bản gốc.** Import là copy: thư mục model của bạn chỉ được đọc. Mọi thao tác
diễn ra trên bản sao trong `Documents/Live2DCompanion/workspaces/`, có cả `original/` lẫn
`working/`.

## Cài và chạy

Cần **Node.js 20+** và Windows/macOS/Linux có GPU (hoặc chấp nhận software rendering).

```bash
git clone https://github.com/<user>/live2d-companion.git
cd live2d-companion
npm install     # postinstall tự sync Cubism Core + sinh .d.ts của framework
npm run dev
```

Lần đầu chạy có sẵn model mẫu Hiyori để thử ngay, không cần tìm model.

### ⚠️ Nếu app crash ngay khi mở

Lỗi `Cannot read properties of undefined (reading 'isPackaged')` là do biến môi trường
`ELECTRON_RUN_AS_NODE=1` — một số terminal tích hợp trong IDE tự set nó. Nó buộc Electron
chạy như Node thuần nên không có `app`.

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE   # PowerShell
```
```bash
unset ELECTRON_RUN_AS_NODE              # bash
```

Đặt rỗng (`ELECTRON_RUN_AS_NODE=`) **không đủ** — Electron chỉ cần biến tồn tại là đổi
hành vi. Phải xoá hẳn.

## Model không có part thì sao?

Rất nhiều model — đặc biệt bản xuất từ Cubism 3.0 (moc3 v2) — không gán mesh vào part nào.
Cây part khi đó chỉ là các thư mục rỗng, nên chức năng ẩn/hiện theo part vô dụng.

App xử lý bằng cách liệt kê thẳng từng mesh, gom theo tiền tố tên nếu tác giả có đặt tên
(`Hair_01`, `Skirt_02`), còn không thì gom theo vùng trên thân. Vùng được cắt theo **số
lượng mesh** chứ không theo chiều cao: Live2D vẽ mặt chi tiết hơn váy rất nhiều, cắt theo
chiều cao sẽ cho một nhóm chiếm nửa model.

Nhiều model loại này lại đã có sẵn hệ thống đổi đồ riêng — tác giả nối mỗi bộ vào một tham
số bật/tắt. App tự dò các tham số đó (bằng cách đo số mesh xuất hiện/biến mất khi kéo từ
0 sang 1, không dựa vào tên vì tên thường là tiếng Nhật/Trung) và cho lưu thành `exp3.json`
chuẩn.

## Dùng chung với anime-companion-vscode

Trang phục và biểu cảm xuất từ app này chạy được ngay trong
[anime-companion-vscode](https://github.com/<user>/anime-companion-vscode) — extension
hiển thị nhân vật Live2D trong VS Code. Xuất model xong, trỏ `animeCompanion.customModels`
vào thư mục đó là dùng được.

## Lệnh

```bash
npm run dev          # chạy chế độ dev
npm run build        # typecheck 3 project + build production
npm test             # unit test (163 test)
npm run smoke        # test đầu-cuối trên file thật: import → render → capture biểu cảm
                     #   → lưu → undo → cấu hình → kiểm tra → xuất
npm run ui:shots     # chụp ảnh từng tab vào .smoke/
npm run package      # đóng gói installer Windows
```

## Giấy phép — đọc trước khi phát hành

Code của project: **MIT** ([LICENSE](LICENSE)).

Nhưng repo này **có nhúng phần mềm của Live2D Inc.** với giấy phép riêng, và điều đó ràng
buộc bạn:

- **Cubism Core** (`vendor/live2dcubismcore/`) — Live2D Proprietary Software License. Chỉ
  3 file được phép phát hành lại, và repo chỉ chứa đúng 3 file đó.
- **Cubism Web Framework** (`vendor/cubism-web-framework/`) — Live2D Open Software License.
- **Model mẫu Hiyori** (`resources/sample-models/`) — Free Material License. Cấm dùng cho
  nội dung khiêu dâm, bạo lực hoặc phân biệt đối xử.

**Phát hành bất kỳ bản build nào ra công chúng đều cần chấp nhận
[SDK Release License](https://www.live2d.com/en/sdk/license/) của Live2D.** Miễn phí cho
cá nhân và doanh nghiệp nhỏ dưới ngưỡng doanh thu Live2D quy định; trên ngưỡng đó cần hợp
đồng trả phí. Điều khoản thay đổi theo thời gian — **tự xác nhận điều khoản hiện hành
trước khi release**, đừng tin vào dòng này.

Chi tiết từng thành phần: [THIRDPARTY.md](THIRDPARTY.md).

## Đóng góp

Kiến trúc, các bẫy đã gặp và quy tắc code: [CONTRIBUTING.md](CONTRIBUTING.md).
Kế hoạch phát triển: [ROADMAP.md](ROADMAP.md).
