# Kết quả kiểm tra dự án ngày 09/10/2026

Kết luận: mã nguồn vượt qua kiểm thử và build, nhưng môi trường Supabase hiện tại chưa đồng bộ schema nên chưa đủ điều kiện nghiệm thu toàn bộ.

## Đã xác minh

- TypeScript, ESLint và Vite build thành công.
- 90 kiểm thử toàn dự án thành công trước các sửa chữa của đợt rà soát. Sau đó chạy riêng các kiểm thử liên quan đến sửa chữa.
- Preview HTTP phục vụ ứng dụng, JavaScript và mẫu chứng nhận thành công. Đây là kiểm tra HTTP, chưa phải kiểm thử tương tác trình duyệt.
- Audit dependency production: 0 lỗ hổng. Audit toàn bộ: 13 cảnh báo (2 thấp, 4 trung bình, 7 cao), thuộc công cụ phát triển; chưa nâng phiên bản lớn trong lần rà soát này.
- Kiểm thử nghiệp vụ chạy PostgreSQL PGlite với Auth/Storage giả lập, không thay đổi Supabase thực.

## Lỗi đã sửa

- Script apply-workflow-migrations thiếu bản vá 20261009_certificate_consistency.sql; đã bổ sung và cập nhật hướng dẫn.
- Công cụ check-live-schema trước đây trả mã thành công dù thiếu schema; đã sửa để báo thất bại.
- PDF email chưa có con dấu của mẫu in; đã đóng gói PNG trong suốt và thêm vào PDF phía máy chủ. PDF đã tạo trước đây không tự cập nhật.
- Bổ sung kiểm thử chống chèn nội dung HTML/URL ảnh không hợp lệ, ảnh PNG nhúng trong mẫu tải về và ảnh nhúng trong PDF email.

## Chưa hoàn tất trên môi trường thật

Truy vấn schema chỉ đọc tới Supabase đang cấu hình báo:

- conferences.review_enabled không tồn tại.
- papers.problem_statement không tồn tại.
- sessions.parent_session_id không tồn tại.
- conference_resources và session_feedback chưa có trong schema cache.
- certificates.attendance_minutes không tồn tại.

Cần chạy migration nền theo README nếu chưa có, rồi 20261008_complete_workflows.sql, 20261008_seminar_experience.sql, 20261009_certificate_consistency.sql theo thứ tự. Không chạy lại initializer hoặc dữ liệu demo trên database đang sử dụng.

Môi trường shell chưa có DATABASE_URL; không có Supabase CLI trong PATH. Vì vậy chưa áp dụng SQL hoặc deploy Edge Functions trong lần kiểm tra này.

Sau khi cập nhật database: deploy paper-download, send-gmail-notification và post-seminar; cấu hình Gmail OAuth, secrets, cron/Vault và Auth redirect URLs theo tài liệu. Kiểm tra đăng nhập/khôi phục mật khẩu, tạo hội thảo, nộp và phản biện bài, đăng ký/điểm danh, camera QR qua HTTPS, tài liệu, kinh phí, cấp/tra cứu chứng nhận và email bằng tài khoản có quyền tương ứng.

Chữ ký số chưa triển khai: signature_hash là mã đối chiếu, ảnh con dấu không phải chữ ký số. Cần chứng thư và dịch vụ ký phía máy chủ nếu yêu cầu chứng nhận có chữ ký số.
