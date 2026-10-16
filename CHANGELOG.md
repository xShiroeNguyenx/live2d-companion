# Changelog

## 0.2.0

### Thêm

- **Thư viện nhiều model**: "Mở thư mục nhiều model…" liệt kê mọi `.model3.json` trong một
  thư mục (kèm ảnh thu nhỏ và ô tìm kiếm) mà không copy gì. Model chỉ được import khi bấm
  vào lần đầu; bấm lại sẽ mở workspace đã có, không ghi đè chỉnh sửa.
- **Chọn nơi lưu workspace**: mục "Lưu trữ" hiện đường dẫn, tổng dung lượng và dung lượng
  ổ còn trống. "Đổi thư mục lưu trữ…" cho chuyển toàn bộ workspace sang ổ khác (có tiến độ),
  hoặc chỉ dùng thư mục mới và để nguyên dữ liệu cũ.
- **Xoá workspace**: mỗi workspace trong "Đã import" hiện dung lượng và có nút xoá (có xác
  nhận). Thư mục model gốc không bị đụng tới; model đang mở không xoá được.
- Icon riêng cho ứng dụng.

### Thay đổi

- Cài mới lưu workspace trong thư mục dữ liệu của app thay vì `Documents` (thư mục hay bị
  OneDrive đồng bộ). Máy đã có workspace trong `Documents` vẫn dùng chỗ cũ cho tới khi đổi.
