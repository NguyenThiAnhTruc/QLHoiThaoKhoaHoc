# ConfManager — Quản lý hội thảo khoa học

React 18, TypeScript, Vite và Supabase (Auth, PostgreSQL, Storage, Edge Functions).

## Chạy cục bộ

```sh
npm ci
npm run dev
```

Tạo `.env` với `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` của dự án Supabase. Không đưa service-role key vào frontend. Đăng ký URL ứng dụng và URL khôi phục mật khẩu trong Supabase Auth.

## Cài đặt database

Chạy tuần tự bằng Supabase SQL Editor:

1. `supabase/migrations/initialize_production.sql` — chỉ cho database mới; không tạo tài khoản hay dữ liệu demo.
2. `supabase/migrations/conference_updates.sql`.
3. `supabase/migrations/20260927_paper_status_consistency.sql`.
4. `supabase/migrations/20260927_disable_blind_review.sql`.
5. `supabase/migrations/20261008_complete_workflows.sql`.
6. `supabase/migrations/20261008_seminar_experience.sql`.

Database đang sử dụng: không chạy initializer. Nếu đã có các cập nhật trước, chạy bước 5–6. Khi cần áp dụng lại tất cả cập nhật, giữ thứ tự trên vì các bản cũ có thể định nghĩa lại hàm đã sửa. Các bản cập nhật mới có thể chạy lại và không xóa dữ liệu/tài khoản. Có `DATABASE_URL` trong môi trường thì chạy `node scripts/apply-workflow-migrations.mjs` để áp dụng hai migration mới.

Tạo tài khoản quản trị bằng quy trình đăng ký thật, rồi quản trị viên Supabase thiết lập `public.profiles.role = 'admin'` cho đúng UUID của tài khoản đó. Tài khoản người dùng khác đăng ký từ ứng dụng; yêu cầu trở thành ban tổ chức phải được quản trị viên duyệt.

Không chạy `conference_management_supabase.sql`, `conference_demo_data.sql` hoặc các script `create_*_accounts.sql` trong môi trường production: chúng chứa tài khoản/dữ liệu mẫu. Với database cũ, kiểm kê chủ sở hữu và dữ liệu liên quan trước khi vô hiệu hóa tài khoản thử; bản cập nhật không tự xóa những tài khoản này.

## Luồng nghiệp vụ

- Ban tổ chức tạo hội thảo, chủ đề, lịch, tiểu ban và quỹ phí. Có thể tắt phản biện hoặc yêu cầu tác giả có bài accepted trước khi đăng ký.
- Tác giả nộp PDF hoặc URL, tóm tắt, từ khóa, nhóm tác giả, tác giả chính, đặt vấn đề và mục tiêu. Metadata, tác giả, trạng thái tham gia, chủ đề và phiên bản được lưu trong một giao dịch.
- Reviewer nhận lời hoặc từ chối nhiệm vụ, chấm và gửi nhận xét. Ban tổ chức quyết định chấp nhận, từ chối hoặc yêu cầu sửa. Nếu tắt phản biện, ban tổ chức quyết định trực tiếp.
- Một phiên chung chứa nhiều phiên báo cáo/tiểu ban song song. Mỗi báo cáo có phòng, bài accepted và thời gian trong phiên chung/hội thảo. Lịch chung giữ từng hội thảo và có bộ lọc lịch tác giả.
- Chứng nhận tham dự yêu cầu điểm danh và hội thảo kết thúc. Chứng nhận báo cáo gắn từng bài accepted, tác giả tham gia, điểm danh và phiên báo cáo đã kết thúc. Cấp lại cùng bài không tạo trùng; tác giả có nhiều bài nhận riêng từng chứng nhận.
- Minh chứng kinh phí là file PDF/ảnh tối đa 10 MB trong bucket riêng tư `fee-proofs`, hoặc URL HTTP/HTTPS. Người nộp và ban tổ chức được đọc; ban tổ chức duyệt khoản nộp.

## Chứng nhận và chữ ký số

Ứng dụng tải PDF tự động đã tạo, hoặc in chứng nhận cấp thủ công để lưu PDF. Mẫu chung tải về tại `/certificate-template.html`, có thể điền trực tiếp và in. Mẫu chưa được cấp số/chữ ký xác nhận. Cấu hình kho tài liệu, khảo sát từng phiên, điểm danh vào/ra và email chứng nhận theo [POST_SEMINAR_AUTOMATION.md](supabase/POST_SEMINAR_AUTOMATION.md).

`signature_hash` hiện là mã đối chiếu MD5; không phải chữ ký số. Muốn phát hành PDF có chữ ký số cần cấu hình chứng thư/khóa của đơn vị và dịch vụ ký phía server. Không đặt khóa ký trong frontend. Chức năng này chưa được triển khai do chưa có chứng thư/dịch vụ ký.

## Kiểm tra và triển khai

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Kiểm thử dùng PostgreSQL cục bộ (PGlite) và các schema Auth/Storage giả lập; không ghi vào Supabase thật. File trong `supabase/tests/` chỉ phục vụ kiểm thử.

Deploy thư mục `dist` sau khi áp dụng migration và cấu hình môi trường. Các Edge Functions `paper-download`, `send-gmail-notification` và `post-seminar` cần được deploy vào cùng Supabase project; cấu hình email theo `supabase/GMAIL_NOTIFICATIONS.md` và `supabase/POST_SEMINAR_AUTOMATION.md`. Kiểm tra đăng nhập, tải PDF, QR camera qua HTTPS và gửi email trên môi trường thực trước nghiệm thu.

Kiểm tra dependency ngày 08/10/2026: `npm audit --omit=dev` không báo lỗ hổng sau cập nhật tương thích. Audit đầy đủ còn 13 cảnh báo ở công cụ phát triển (ESLint, Vite/esbuild, Tailwind và dependency liên quan); việc xử lý toàn bộ cần nâng phiên bản lớn và kiểm tra lại cấu hình build.
