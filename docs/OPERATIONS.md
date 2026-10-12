# Vận hành và kiểm thử

## Kiểm thử Supabase thật

Chạy `scripts/configure-live-test.ps1` trong PowerShell để nhập bốn tài khoản thử. File `.local/live-test-accounts.json` không được đưa lên Git; chứa mật khẩu rõ để công cụ đọc, nên chỉ dùng tài khoản thử và xóa sau kiểm thử. Chạy `node scripts/verify-live-access.mjs`: công cụ đăng nhập, xác nhận vai trò và phạm vi đọc chứng nhận, không thay đổi dữ liệu nghiệp vụ. Đây chưa phải kiểm thử trọn quy trình hoặc kiểm tra đồng thời.

Để kiểm thử nghiệp vụ bằng giao diện local, đặt tên hội thảo `[TEST]` và tắt gửi email tự động. Dùng các tài khoản thử lần lượt tạo hội thảo, nộp PDF, giao phản biện, nhận lời và đánh giá, quyết định bài, đăng ký, điểm danh và cấp chứng nhận. Kiểm tra thông báo và số lượng bản ghi sau mỗi bước. Mở hai cửa sổ độc lập để thử đăng ký chỗ cuối, quyết định bài bằng dữ liệu cũ và quét cùng mã điểm danh. Chỉ dọn hội thảo có tiền tố thử cùng ID đã ghi nhận; không xóa tài khoản có dữ liệu khác.

## Database và file

`scripts/backup-database.ps1` dùng `DATABASE_URL` ở môi trường server, cùng `pg_dump` và `pg_restore`. Script tạo archive, đọc lại danh mục và ghi SHA256 trong `.local/backups`; không lưu mật khẩu vào manifest. Tham số `-PostgresBin` chọn thư mục PostgreSQL client tools. Đọc archive thành công chưa chứng minh khả năng khôi phục.

Trước sử dụng thực tế, thử khôi phục vào database riêng: kiểm tra SHA256, dùng `pg_restore --list`, khởi tạo môi trường Supabase tương thích (roles/extensions), rồi restore archive vào database thử. Không thử restore trực tiếp lên production. Đối chiếu số bản ghi, đăng nhập tài khoản thử, phân quyền, file tải xuống và cấp chứng nhận sau restore. Sao lưu toàn database có thể chứa dữ liệu nhạy cảm; lưu bản sao ở nơi hạn chế truy cập, ngoài ổ đĩa máy đang chạy dự án.

Backup PostgreSQL chỉ gồm metadata Storage. Phải sao lưu dữ liệu file từng bucket qua Storage API hoặc công cụ lưu trữ, kèm bucket/path và checksum; kiểm tra tải lại file khi diễn tập khôi phục. Chưa có bản backup thực tế hoặc diễn tập restore trong phiên này. Chốt lịch backup, thời gian giữ và mức mất dữ liệu chấp nhận được trước khi bật lịch tự động.

## Theo dõi lỗi và nhật ký

Lỗi render có màn hình khôi phục và mã tham chiếu; console không ghi nội dung form, token hoặc hồ sơ. Đây là theo dõi local, chưa có nơi nhận lỗi tập trung. Kiểm tra log Supabase Auth, database và Edge Functions khi vận hành. Bảng `audit_logs` đã có nhật ký quản trị; thu hồi chứng nhận ghi `certificate.revoked` và lý do. Không cho người dùng sửa/xóa nhật ký.

## Nâng cấp mới

Áp dụng `20261011_certificate_verification.sql` `20261011_review_revision.sql` và `20261011_audit_integrity.sql` theo thứ tự, hoặc bundle nâng cấp sau khi có backup. Mã QR trên bản in dùng địa chỉ giao diện hiện tại: QR tạo ở `localhost` chỉ có ý nghĩa trên máy đó; tạo lại bản in bằng URL triển khai khi chia sẻ. Token QR là đường dẫn đối chiếu, không phải chữ ký số. Thu hồi chặn lượt gửi email chưa bắt đầu; thư đã gửi hoặc lượt gửi đã bắt đầu có thể vẫn tới người nhận. File/bản in đã tải trước đó không bị xóa; trang tra cứu thể hiện trạng thái hiện tại.


## Kiểm thử toàn bộ workflow bằng API thật

Sau khi đã cấu hình bốn tài khoản và áp dụng các migration mới, chạy `npm run verify:live-workflow`. Công cụ dùng quyền của từng tài khoản qua Supabase API, tạo một hội thảo `[TEST]`, tải PDF thật và chạy đăng ký chỗ cuối đồng thời, nộp bài/thử lại, phân quyền đọc/quyết định, phản biện, chống ghi đè bản cũ, điểm danh lặp, cấp chứng nhận đồng thời và tra cứu công khai. Tác vụ email tự động luôn tắt; không gọi function gửi email hoặc dọn file.

Kết quả và ID bản ghi/file nằm trong `.local/live-workflow-<conference-id>.json`. Công cụ giữ dữ liệu thử để đối chiếu; không tự xóa hoặc sửa dữ liệu khác. Khi lỗi, kiểm tra đúng bước và ID này trước khi chạy lại, tránh tạo thêm hội thảo thử. File PDF đã tải hoặc bản ghi đã commit có thể tồn tại nếu mất phản hồi. Thử lại nộp bài chỉ mô phỏng bỏ qua phản hồi đã nhận; đây không phải kiểm tra ngắt mạng vật lý. Kiểm tra đồng thời dùng các request Supabase song song; vẫn cần kiểm tra sử dụng qua giao diện và khôi phục backup.
