# Chạy và kiểm tra trên local

Mở PowerShell tại D:\duan\project\project.

## Khởi động

1. Cài dependency nếu chưa có: npm ci.
2. Điền VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trong .env theo .env.example. Chỉ dùng khóa công khai; không đặt service-role key trong VITE_*.
3. Chạy npm run dev -- --host 127.0.0.1 --port 5173.
4. Mở http://localhost:5173/.

Giao diện chạy local, backend vẫn là Supabase theo .env. Chưa cài Supabase/PostgreSQL riêng trên máy này.

## Database đang dùng

Kiểm tra: npm run verify:schema.

Nếu còn thiếu schema: mở supabase/migrations/upgrade_existing_database.sql, dán toàn bộ vào SQL Editor của đúng Supabase project rồi Run. File gộp các cập nhật trong một giao dịch, không chứa initializer hoặc dữ liệu demo. Migration nền chuyển ngày cũ sang thời điểm theo múi giờ Việt Nam; ngày tổ chức được giữ lại. Sau đó chạy lại npm run verify:schema.

Chỉ dùng initialize_production.sql nếu tạo database mới. Không chạy initializer trên database đang sử dụng.

Có DATABASE_URL của database đã cập nhật nền thì có thể chạy node scripts/apply-workflow-migrations.mjs để áp dụng ba migration mới. Không dán mật khẩu hoặc chuỗi kết nối vào chat hoặc frontend.

## Kiểm thử

- npm run check: TypeScript, ESLint, bộ kiểm thử PostgreSQL giả lập, build và HTTP preview. Không ghi lên Supabase thật.
- npm run verify:ui: Chrome headless kiểm tra trang công khai, menu/render các trang dữ liệu rỗng cho 5 vai trò với API giả lập cách ly, modal, lỗi hồ sơ/thử lại và in PDF một trang. Cần Google Chrome tại vị trí tiêu chuẩn Windows. Ảnh chụp nằm trong docs/ui-review.
- npm run verify:schema: kiểm tra chỉ đọc các bảng/cột backend. Cần kết nối mạng tới Supabase.
- npm run db:bundle: tạo lại file SQL gộp khi migration nguồn thay đổi.

Các tính năng tài liệu, khảo sát và cấu hình mới chỉ hoạt động đầy đủ sau khi schema đã cập nhật. PDF email và tải bài báo qua function cần Edge Functions theo README; ứng dụng local không thay thế các function phía server. Camera QR có thể dùng trên localhost sau khi cho phép quyền camera.

Chưa cấu hình hoặc triển khai VPS trong giai đoạn này.


Bản sửa độ tin cậy: áp dụng `20261010_email_delivery_safety.sql` sau các migration trước đó, hoặc chạy lại bundle `upgrade_existing_database.sql`. Migration bổ sung trạng thái email cần đối chiếu và quyền dọn file chưa được sử dụng. Sau đó triển khai lại function `post-seminar`; không cập nhật worker trước schema.


Dọn file bỏ dở: xem [UPLOAD_CLEANUP.md](../supabase/UPLOAD_CLEANUP.md). Migration `20261010_orphan_upload_cleanup.sql` đã nằm trong bundle nâng cấp; cần deploy function `upload-cleanup` riêng để thực hiện dọn file.
