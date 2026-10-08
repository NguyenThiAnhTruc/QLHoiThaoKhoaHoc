# Hoàn thiện trải nghiệm hội thảo

## Thứ tự triển khai

1. Với database đang dùng, áp dụng migration nền theo README, rồi `20261008_complete_workflows.sql` và `20261008_seminar_experience.sql`. Không chạy dữ liệu mẫu trên production. Có thể đặt `DATABASE_URL` trong môi trường shell và chạy `node scripts/apply-workflow-migrations.mjs` để áp dụng hai migration mới. Script không khởi tạo lại database hoặc in thông tin đăng nhập.
2. Deploy giao diện sau khi migration thành công. Lịch trình có lưới theo ngày/phòng, tìm diễn giả, chủ đề và mức độ; lịch riêng mỗi hội thảo vẫn nằm trong trang hội thảo. `Lịch của tôi` lọc các phiên tác giả báo cáo.
3. Diễn giả mở `Báo cáo của tôi` → phiên → tải PDF/PPT/PPTX trước hạn. Ban tổ chức quản lý tài liệu công khai, cho người đăng ký hoặc chỉ người đã điểm danh. Bucket là private, quyền tải được kiểm tra ở server.
4. Ban tổ chức tạo QR cho từng phiên. Người tham dự cần đăng ký và điểm danh hội thảo trước khi ghi nhận vào/ra phiên. Khảo sát mở sau khi phiên kết thúc, mỗi người đã điểm danh trả lời một lần. Ban tổ chức xem điểm tổng hợp; câu trả lời cá nhân không công khai.
5. Cấu hình tác vụ dưới đây, sau đó bật `Tự động cấp chứng nhận` / `Tự động gửi khảo sát` trong form hội thảo. Hai tùy chọn mặc định tắt.

## Email và PDF tự động

Function `post-seminar` chạy phía server, không gọi trực tiếp từ trình duyệt. Đặt secrets trong Supabase Edge Function Secrets:

- `POST_SEMINAR_JOB_SECRET`: chuỗi ngẫu nhiên riêng cho cron, tối thiểu 32 ký tự.
- `APP_URL`: địa chỉ HTTPS của giao diện đã deploy.
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`: cùng cấu hình Gmail OAuth như [GMAIL_NOTIFICATIONS.md](./GMAIL_NOTIFICATIONS.md).
- Supabase tự cung cấp `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`. Không đặt service key hoặc Gmail credentials trong `VITE_*`.

Deploy bằng Supabase CLI có hỗ trợ static files: `supabase functions deploy post-seminar`. `supabase/config.toml` đóng gói phông Noto Sans và tắt kiểm tra JWT riêng của function; handler vẫn bắt buộc `X-Job-Secret`.

Trong Supabase Vault, tạo secrets tên `post_seminar_url` (URL function đầy đủ) và `post_seminar_job_secret` (giống secret của function). Sau đó bật extensions `pg_cron`, `pg_net` và tạo lịch trong SQL Editor:

```sql
select cron.schedule('post-seminar-every-10-minutes', '*/10 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'post_seminar_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Job-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'post_seminar_job_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
```

Kiểm tra function logs và bảng `post_seminar_jobs`. Mỗi lượt xử lý tối đa 5 email, thử lại tối đa 5 lần; job đang xử lý quá 10 phút được lấy lại. Một chứng nhận / một lời mời khảo sát chỉ có một job. Nếu Gmail đã nhận email nhưng cập nhật trạng thái thất bại, lần thử lại có thể gửi trùng; hệ thống không cam kết gửi đúng một lần khi mạng lỗi. Để thử lại một job lỗi sau khi sửa cấu hình, ban quản trị database có thể đặt `status='pending', attempts=0` cho đúng job cần xử lý.

Chứng nhận tự động chỉ cấp sau ngày kết thúc cho người có điểm danh hội thảo thực tế. PDF tiếng Việt được lưu private và đính kèm email. Số phút được tính từ vào/ra từng phiên, giới hạn trong thời gian phiên và gộp khoảng trùng; thiếu dữ liệu ra phiên sẽ không tự suy đoán số giờ. PDF chưa có chữ ký số: cần chứng thư và quy trình ký hợp lệ trước khi bổ sung.

Phông Noto Sans phân phối kèm [OFL.txt](./functions/post-seminar/assets/OFL.txt). Tài liệu chính thức: [Supabase static files](https://supabase.com/docs/guides/local-development/cli/config#functions.function_name.static_files), [Supabase scheduled functions](https://supabase.com/docs/guides/functions/schedule-functions), [Gmail gửi email](https://developers.google.com/workspace/gmail/api/guides/sending).
