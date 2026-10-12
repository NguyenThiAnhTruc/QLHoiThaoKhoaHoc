# Dọn file tải lên bị bỏ dở

Worker chỉ xử lý bucket `conference-resources` và `fee-proofs`, file tồn tại hơn 24 giờ và không được bản ghi nào sử dụng. Không xóa file bài báo hoặc PDF chứng nhận. Database giữ reservation trước khi gọi Storage API; trigger không cho gắn file đã được đặt lịch xóa. File đang được tham chiếu được giữ lại. Reservation chưa hoàn tất được thử lại trong lượt tiếp theo.

## Cài đặt

1. Chạy bundle `migrations/upgrade_existing_database.sql`, hoặc migration `20261010_orphan_upload_cleanup.sql` sau `20261010_email_delivery_safety.sql`.
2. Đặt secret ngẫu nhiên `UPLOAD_CLEANUP_JOB_SECRET` ở môi trường server của Supabase Functions. Không đặt trong `VITE_*`.
3. Deploy function `upload-cleanup`. Worker sử dụng `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY` của môi trường Functions.
4. Gọi POST function với header `X-Job-Secret`. Mỗi lượt xử lý tối đa 25 file; phản hồi gồm `cleaned` và `failed`.

Local có thể chạy function bằng Supabase CLI với file secret nằm ngoài repository: `supabase functions serve upload-cleanup --env-file <file-secret>`. Frontend local không tự kích hoạt việc xóa.

## Lịch chạy trên Supabase

Khi đã deploy và muốn bật tự động, tạo Vault secrets `upload_cleanup_url` (URL đầy đủ của function) và `upload_cleanup_job_secret`. Bật `pg_cron`, `pg_net`, rồi chạy SQL sau một lần:

```sql
select cron.schedule('upload-cleanup-hourly', '17 * * * *', $$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='upload_cleanup_url'),
  headers := jsonb_build_object('Content-Type','application/json','X-Job-Secret',
   (select decrypted_secret from vault.decrypted_secrets where name='upload_cleanup_job_secret')),
  body := '{}'::jsonb,
  timeout_milliseconds := 60000
 );
$$);
```

Đối chiếu function logs và `public.upload_cleanup_jobs`. `cleaned_at IS NULL` nghĩa là chưa xác nhận xóa; không xóa reservation thủ công vì reservation bảo vệ thao tác lưu đồng thời. Worker xóa qua Storage API, không dùng SQL để xóa `storage.objects`, để xử lý cả dữ liệu file.

Chưa bật lịch hoặc deploy function thì file bỏ dở vẫn tồn tại. Kiểm thử local dùng database tạm và Storage API giả lập; không xác nhận hoạt động của Storage thật.
