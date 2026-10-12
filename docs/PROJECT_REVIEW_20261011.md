# Kiểm tra và nâng cấp các luồng quản lý hội thảo

## Đã triển khai trong mã

- Phân trang hiển thị người tham dự (25/trang), chứng nhận (12/trang); giới hạn trang bài báo khi dữ liệu thay đổi. Số thống kê và xuất file lấy toàn bộ kết quả đã lọc. Hiện dữ liệu vẫn được tải toàn bộ theo từng batch; chưa chuyển sang phân trang truy vấn phía server.
- Tìm kiếm không dấu tiếng Việt nhất quán ở bài báo, người tham dự và chứng nhận. Bổ sung xuất Excel XML cho ba danh sách, bên cạnh CSV ở các trang đã có.
- Quyết định bài báo so sánh `updated_at`; lưu phản biện so sánh `revision`; điểm danh so sánh trạng thái cũ. Ghi không có bản ghi trả về được báo lỗi thay vì báo thành công. Kiểm thử database chứng minh cập nhật bản phản biện cũ không ghi đè phiên bản mới; chưa chứng minh tranh chấp bằng hai kết nối PostgreSQL thật.
- QR tra cứu trên bản in chứng nhận, trang công khai xác nhận hiệu lực theo token, thu hồi có lý do, nhật ký và chặn tải PDF bị thu hồi. Luồng tra cứu theo số chứng nhận cũ không báo chứng nhận thu hồi là hợp lệ. Token lookup không cung cấp email hoặc hồ sơ; lookup số cũ vẫn giữ dữ liệu người nhận để tương thích.
- Chặn người dùng gọi RPC ghi nhật ký tùy ý. Kiểm thử quyền cho người ngoài, người nhận, ban tổ chức và người chưa đăng nhập.
- Xử lý lỗi tải thông báo, lỗi điểm danh và lỗi render để không giữ trạng thái đang xử lý; lỗi render có mã tham chiếu local, chưa gửi tới dịch vụ giám sát tập trung.
- Công cụ nhập tài khoản thử trên máy và kiểm tra truy cập Supabase chỉ đọc. Script backup có kiểm tra archive và checksum, chưa chạy backup/restore thực tế.

## Cần áp dụng trên Supabase

Đã xác nhận các nhóm schema cũ có mặt ở lượt kiểm tra trước. Các migration mới trong lượt này chưa áp dụng: `20261011_certificate_verification.sql`, `20261011_review_revision.sql`, `20261011_audit_integrity.sql`. Có thể chạy `20261011_local_improvements.sql` nếu đã áp dụng bundle đến 20261010. Với database cần nâng cấp đầy đủ, dùng `upgrade_existing_database.sql`. Sao lưu trước khi áp dụng.

## Chưa thể xác nhận

- Chưa nhập tài khoản thử vào `.local/live-test-accounts.json`; chưa chạy luồng hội thảo đầy đủ trên Supabase thật.
- Máy có thư mục dữ liệu PostgreSQL 17 nhưng không có `initdb`, `pg_ctl`, `pg_dump`; thử khởi tạo cluster riêng không thực hiện được. Script kiểm tra đồng thời đăng ký đã có nhưng chưa chạy trong phiên này.
- Chưa có kết nối PostgreSQL quản trị, backup file Storage hoặc diễn tập khôi phục.
- Email tự động và dọn file theo lịch vẫn bỏ qua theo yêu cầu người dùng. PDF email chưa được bổ sung QR; QR hiện áp dụng cho bản in phía trình duyệt.

Hướng dẫn nhập tài khoản thử, kiểm tra, backup và giới hạn vận hành: `OPERATIONS.md`.

## Kiểm tra tiếp trên Supabase thật

Lượt kiểm tra tiếp xác nhận cả 9 mục schema trong `verify:schema` đạt, gồm QR/thu hồi, phiên bản phản biện và RPC tra cứu token. Chưa cấu hình tài khoản thử trên máy nên `verify:live-access` và `verify:live-workflow` dừng trước thao tác nghiệp vụ. Đã chuẩn bị công cụ `scripts/live-workflow.mjs` cho toàn quy trình và các request đồng thời; chưa coi các bước này là đạt cho đến khi chạy với tài khoản thật. Không tạo dữ liệu thử hoặc gọi tác vụ email trong lượt chuẩn bị này.
