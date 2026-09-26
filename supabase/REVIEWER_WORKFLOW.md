# Luồng người phản biện

## Triển khai

Database đang sử dụng: chạy `migrations/20260925_reviewer_workflow.sql` trong SQL
Editor sau `20260925_author_workflow.sql`, rồi triển khai frontend mới.
Database mới: bản SQL tổng đã bao gồm cả hai bản cập nhật.
Chạy lại migration Reviewer không xóa phân công hay kết quả đã có.

## Quy trình

1. Admin/BTC chọn tài khoản Tác giả hoặc Reviewer để phân công bài.
2. Người được giao mở **Phản biện được giao** hoặc chi tiết bài, chọn **Nhận phản biện**
   hoặc **Từ chối phân công** và nhập lý do.
3. Nhận việc chuyển `assigned` → `in_progress`; từ chối chuyển `assigned` → `declined`.
   Phản hồi được ghi thời gian, lưu nhật ký và thông báo cho admin/BTC phụ trách.
4. Chỉ người đã nhận việc mới gửi đánh giá. Cần điểm tổng, nhận xét và khuyến nghị.
   Khi hoàn thành, thời điểm do database ghi; kết quả đã hoàn thành không sửa lại qua API.
5. Nếu từ chối, BTC có thể chọn người khác. Để mời lại cùng người, xóa phân công cũ
   (có xác nhận) rồi tạo phân công mới. Nhật ký phản hồi vẫn được giữ.

Tài khoản Reviewer có trang tổng quan riêng với số lời mời chờ xác nhận, đang làm,
đã hoàn thành và đã từ chối. Không còn dùng màn hình tác giả/nút nộp bài.
Danh sách và quyền đọc kết quả phản biện được giới hạn theo người được giao;
người nộp/đồng tác giả và admin/BTC phụ trách vẫn xem được các kết quả liên quan.
Phân công đã từ chối vẫn giữ trong lịch sử, không tính là việc đang chờ hoặc quá hạn.

Các phân công `assigned` cũ cần xác nhận trước khi làm. `in_progress` và `completed`
cũ được giữ nguyên. Thời hạn phản biện hiện có vẫn áp dụng cho thao tác nhận/từ chối
và gửi đánh giá; quá hạn cần liên hệ BTC. Chưa có hạn trả lời lời mời riêng.
Thông báo là thông báo nội bộ theo tùy chọn `reviews` của người nhận, không tự gửi Gmail.

## Kiểm thử

Chạy `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
Bộ PostgreSQL cục bộ kiểm tra nhận/từ chối, phản hồi hộ bị chặn, điểm trước khi nhận
bị chặn, lý do từ chối, thông báo, kết quả cũ và quyền đọc giữa các reviewer.
Chưa thay thế kiểm thử trên Supabase thật với tài khoản đã triển khai migration.
