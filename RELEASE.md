# Quy trình phát hành

## Lần đầu: đưa repo lên GitHub

Repo chưa được khởi tạo git. Chạy từ thư mục dự án:

```bash
git init
git add -A
git commit -m "Initial commit: Live2D Companion Studio"
git branch -M main
```

Tạo repo trống trên GitHub (không tick "Add README"), rồi:

```bash
git remote add origin https://github.com/<user>/live2d-companion.git
git push -u origin main
```

Hoặc dùng `gh` để tạo và push một lượt:

```bash
gh repo create live2d-companion --public --source=. --remote=origin --push
```

**Kiểm tra trước khi push:** `git status` không được liệt kê `node_modules/`, `out/`,
`release/`, `.smoke/`. Nếu có, `.gitignore` chưa được đọc — kiểm tra lại rồi
`git rm -r --cached <thư mục>`.

Repo nặng khoảng **7 MB** vì có vendor SDK (2.2 MB) và model mẫu Hiyori (4.8 MB). Cả hai
đều được phép phát hành lại — xem phần giấy phép bên dưới.

## Trước mỗi lần release

```bash
npm ci                # cài sạch từ lockfile, giống hệt CI
npm run typecheck
npm test
npm run build
npm run smoke         # cần GPU hoặc SwiftShader; chạy lại nếu fail lần đầu (xem ROADMAP)
npx electron-builder --config electron-builder.yml --dir --publish never
```

Bước cuối đóng gói vào `release/win-unpacked/` mà không tạo installer — nhanh hơn và đủ để
kiểm tra. Mở `release/win-unpacked/Live2D Companion Studio.exe` và xác nhận app khởi động,
model mẫu Hiyori mở được.

## Tăng version và gắn tag

> **Tag là điểm không quay lại.** Push tag xong là workflow build và **publish công khai
> luôn**, không có bước duyệt. Chạy hết checklist bên trên, và đọc phần giấy phép bên dưới,
> *trước khi* tag.

Version nằm trong `package.json`. Dùng `npm version` để nó tự commit và tag:

```bash
npm version patch     # 0.0.1 -> 0.0.2   (sửa lỗi)
npm version minor     # 0.0.1 -> 0.1.0   (tính năng mới)
npm version major     # 0.9.0 -> 1.0.0   (thay đổi phá vỡ tương thích)
```

Lệnh này tạo commit `v0.1.0` và tag cùng tên. Đẩy cả hai:

```bash
git push origin main --follow-tags
```

Tag `v*` kích hoạt workflow `Release`: chạy typecheck + unit test, build installer cho
Windows / macOS / Linux, rồi publish release kèm file. Không cần thao tác gì thêm.

### Pre-release khi chưa chắc

Tag có dấu gạch ngang tự động thành pre-release — không hiện là bản tải mới nhất, và gỡ đi
ít phiền hơn:

```bash
npm version 0.2.0-beta.1
git push origin main --follow-tags
```

Dùng cái này cho lần release đầu tiên, hoặc bất cứ khi nào chưa tự tin.

### Lỡ tag nhầm

Release đã public rồi thì xoá được, nhưng file có thể đã có người tải:

```bash
gh release delete v0.1.0 --yes --cleanup-tag
```

Hoặc xoá tay trên GitHub rồi:

```bash
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
```

## Build thủ công (không qua CI)

```bash
npm run package       # Windows NSIS installer, ra release/
```

macOS và Linux chỉ build được trên đúng hệ điều hành đó — đó là lý do workflow release dùng
matrix ba OS.

## ⚠️ Giấy phép Live2D — bắt buộc đọc

Repo này nhúng phần mềm của Live2D Inc. Trước khi publish **bất kỳ bản build nào**:

1. **SDK Release License.** Phát hành ứng dụng dựng trên Cubism SDK cần chấp nhận
   [giấy phép này](https://www.live2d.com/en/sdk/license/). Miễn phí cho cá nhân và doanh
   nghiệp nhỏ dưới ngưỡng doanh thu Live2D quy định; trên ngưỡng cần hợp đồng trả phí.
2. **Ngưỡng doanh thu thay đổi theo thời gian.** Tự kiểm tra điều khoản tại thời điểm
   release — đừng tin con số nhớ được từ lần trước.
3. **Model Hiyori** đi kèm theo Free Material License: cấm dùng cho nội dung khiêu dâm,
   bạo lực hoặc phân biệt đối xử. Nếu app của bạn có thể bị dùng theo hướng đó, cân nhắc
   bỏ model mẫu khỏi bản phát hành.
4. **Chỉ 3 file Core được phép phát hành lại** — repo chỉ chứa đúng 3 file đó. Đừng thêm
   file nào khác từ gói SDK.

Chi tiết: [THIRDPARTY.md](THIRDPARTY.md).

## Ký số (chưa làm)

Installer hiện **không được ký**, nên Windows SmartScreen sẽ cảnh báo ở lần chạy đầu. Muốn
ký, đặt secret trong repo:

- `CSC_LINK` — chứng chỉ `.pfx` mã hoá base64
- `CSC_KEY_PASSWORD` — mật khẩu của chứng chỉ

electron-builder tự nhận hai biến này; workflow không cần sửa.

## Nếu release hỏng giữa chừng

Tag đã đẩy nhưng build lỗi: sửa, rồi ép tag sang commit mới.

```bash
git tag -d v0.1.0
git push origin :refs/tags/v0.1.0
# sửa xong, commit, rồi tag lại
git tag v0.1.0
git push origin v0.1.0
```

Xoá release cũ trên GitHub trước khi đẩy tag lại, nếu không workflow sẽ ghi đè lên release
đang có cùng tên.
