# Áp dụng bản sửa phân quyền 2026-09-23

## Dự án Supabase đang sử dụng

1. Deploy Edge Function trước khi đưa frontend mới lên:
   `supabase functions deploy paper-download --project-ref <project-ref>`.
   Hàm dùng `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   do môi trường Supabase cung cấp; không đưa service-role key vào frontend.
2. Chạy toàn bộ `migrations/conference_updates.sql` trong SQL Editor.
   Migration chạy trong transaction, không sửa hoặc xóa dữ liệu hiện có.
3. Deploy frontend cùng bản sửa này. Frontend đọc bài bằng RPC `read_papers`
   và lấy quyền hội thảo bằng `managed_conferences`.

Không chạy lại toàn bộ `conference_management_supabase.sql` trên database thật
chỉ để áp dụng bản sửa: file đó có dữ liệu demo. Với database mới, file tổng hợp
đã chứa bản sửa ở cuối, sau các phần schema cũ.

## Hành vi được sửa

- Bài mới chỉ được khởi tạo ở trạng thái `submitted`, phiên bản 1.
- Đăng ký tham dự không được tự đặt `attended = true`.
- Tác giả chỉ thấy nhiệm vụ của mình trong trang “Phản biện được giao”.
- Staff dùng quyền theo hội thảo để điểm danh và cấp chứng nhận, bất kể vai trò
  tài khoản; không được thao tác ở hội thảo khác.
- Tên người tổ chức, diễn giả, người tham dự và người gửi tin nhắn được đọc từ
  `profile_directory`, không mở rộng quyền đọc số điện thoại/hồ sơ riêng tư.
- Hội thảo bật `blind_review`: người ngoài nhóm tác giả và nhóm quản lý không
  đọc được người nộp hay đường dẫn storage chứa ID tác giả qua bảng `papers`.
  RPC trả bản ghi đã che thông tin; lịch sử phiên bản chứa thông tin người tải lên
  không được chia sẻ với người đọc ẩn danh. PDF hiện tại được tải qua Edge Function.
  Việc chia sẻ bài `accepted` không làm mất lớp bảo vệ này.

Hàm tải ẩn danh chỉ phục vụ tệp trong bucket `paper-files` của chính dự án
(bao gồm URL public cũ của bucket). Bài dùng URL bên ngoài cần được tải lại dưới
dạng PDF vào ứng dụng. PDF dùng cho phản biện vẫn cần được tác giả/ban tổ chức
loại bỏ tên và thông tin nhận diện trong nội dung hoặc metadata; bản sửa không
biên tập nội dung PDF.

## Kiểm thử

- `npm run typecheck`, `npm run lint`, `npm run build`.
- `node --test supabase/tests/paper-download.test.mjs` kiểm tra endpoint tải PDF
  với các phản hồi upstream giả lập, bao gồm từ chối truy cập và không lộ đường dẫn.
- `psql -v ON_ERROR_STOP=1 -f supabase/tests/role_permissions.sql` kiểm tra RLS
  bằng các tài khoản fixture và rollback toàn bộ fixture khi hoàn tất.
  Chỉ chạy trên database kiểm thử đã có schema và migration.
- `tests/local_bootstrap.sql` chỉ dùng khi tạo PostgreSQL tạm ngoài Supabase:
  mô phỏng tối thiểu schema `auth`, `storage`; không chạy file này trên Supabase.

Kiểm thử PostgreSQL cục bộ không thay thế kiểm thử tích hợp Auth, PostgREST và
Storage thật sau khi deploy. Kiểm tra trên staging với từng vai trò, đặc biệt
luồng đọc PDF ẩn danh và các truy vấn nối với `profile_directory`.
PostgREST hỗ trợ nối khóa ngoại với view và hàm trả về kiểu bảng:
https://postgrest.org/en/v12/references/api/resource_embedding.html
