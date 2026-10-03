# Các file SQL triển khai

| File                                 | Công dụng                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `conference_management_supabase.sql` | Khởi tạo database mới, gồm schema và tài khoản demo cơ bản.                                              |
| `conference_updates.sql`             | Toàn bộ bản cập nhật: phân quyền, ngày giờ, điểm danh, chứng nhận, phản biện, email, lĩnh vực và chủ đề. |
| `conference_demo_data.sql`           | Dữ liệu mẫu tùy chọn: tài khoản mẫu và 22 hội thảo thuộc 12 lĩnh vực.                                    |
| `create_author_accounts.sql`         | Tạo 7 tài khoản tác giả thật trong `auth.users`, `auth.identities` và `public.profiles`.                 |

Database mới: chạy file khởi tạo → file cập nhật → file dữ liệu mẫu nếu cần.

Database đang sử dụng: chỉ chạy `conference_updates.sql`. File cập nhật có thể chạy lại, giữ nguyên giờ tổ chức đã lưu; phần cuối chuẩn hóa lĩnh vực/chủ đề của 10 hội thảo mẫu theo ID và đồng bộ quyền xem bài báo theo từng hội thảo.

Để thêm 7 tài khoản tác giả vào database đang sử dụng, chạy `create_author_accounts.sql`. Mật khẩu mặc định của các tài khoản là `Demo@123456`; nên đổi mật khẩu sau lần đăng nhập đầu tiên.

Không chạy lại file khởi tạo trên database đang sử dụng vì có phần đặt lại tài khoản và dữ liệu demo. File dữ liệu mẫu cũng đặt lại lịch, trạng thái và thông tin mẫu; chỉ chạy khi muốn nạp lại dữ liệu demo.

Các bản vá có ngày đã được gộp thành từng khối `BEGIN SECTION`/`END SECTION`. Giữ các dấu này để kiểm thử có thể đọc đúng khối SQL. Các file SQL trong `../tests/` chỉ phục vụ kiểm thử, không phải file triển khai.

Để chỉ bổ sung hội thảo đa lĩnh vực, chạy riêng khối `multidisciplinary_demo` cuối file dữ liệu mẫu. Khối này thêm 12 hội thảo và 24 bài báo giả lập (2 bài/hội thảo), cập nhật phần giới thiệu hội thảo và tóm tắt bài báo đã có, không tạo trùng khi chạy lại. Bài báo mới có tiêu đề, tóm tắt và từ khóa, chưa đính kèm PDF.
