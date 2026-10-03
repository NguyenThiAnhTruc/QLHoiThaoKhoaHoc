# Cập nhật chức năng admin

Chạy `migrations/conference_updates.sql` trong Supabase SQL Editor trước khi sử dụng nút chuyển chủ hội thảo. Không chạy lại toàn bộ file khởi tạo trên database đang sử dụng.

- Chuyển chủ: mở chi tiết hội thảo, chọn **Chuyển chủ hội thảo**, chọn tài khoản admin hoặc ban tổ chức rồi xác nhận. Database kiểm tra quyền, phát hiện chủ đã thay đổi và ghi audit log trong cùng transaction.
- Lịch sử quản trị: tìm kiếm toàn bộ lịch sử, lọc hành động, phân trang 25 dòng và bấm tên hành động để xem chi tiết.
- Tổng quan và tài khoản: tải nhiều trang dữ liệu để không bị cắt ở giới hạn trả về của API.
- Đổi vai trò: phát hiện trường hợp vai trò đã bị người khác thay đổi hoặc tài khoản không còn được phép cập nhật.

Lịch sử và thống kê hiện được tải đầy đủ về trình duyệt. Với lượng dữ liệu lớn, nên chuyển sang thống kê tổng hợp và tìm kiếm phân trang tại database để giảm thời gian tải.

Kiểm tra: `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `node --test supabase/tests/*.test.mjs`.
