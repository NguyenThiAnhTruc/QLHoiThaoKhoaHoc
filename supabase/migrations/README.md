# Các file SQL triển khai

Production mới: dùng `initialize_production.sql` thay cho file khởi tạo chứa demo, rồi chạy `conference_updates.sql`, hai bản vá `20260927_*`, `20261008_complete_workflows.sql` và `20261008_seminar_experience.sql`. Xem `../../README.md` để biết thứ tự triển khai và cấu hình.

Database đã có cập nhật cũ: chạy hai migration `20261008_*` theo thứ tự trên để bổ sung lưu bài nguyên tử, cấu hình tắt phản biện, phiên song song, chứng nhận theo từng bài, minh chứng kinh phí riêng tư, kho tài liệu, khảo sát phiên và hàng đợi email/PDF. Áp dụng hai file này sau các bản cập nhật cũ.

| File                                 | Công dụng                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `conference_management_supabase.sql` | Khởi tạo database mới, gồm schema và tài khoản demo cơ bản.                                              |
| `conference_updates.sql`             | Toàn bộ bản cập nhật: phân quyền, ngày giờ, điểm danh, chứng nhận, phản biện, email, lĩnh vực và chủ đề. |
| `conference_demo_data.sql`           | Dữ liệu mẫu tùy chọn: tài khoản mẫu và 22 hội thảo thuộc 12 lĩnh vực.                                    |
| `create_author_accounts.sql`         | Tạo 7 tài khoản tác giả thật trong `auth.users`, `auth.identities` và `public.profiles`.                 |

Môi trường thử nghiệm có dữ liệu mẫu: chạy file khởi tạo chứa demo → file cập nhật → file dữ liệu mẫu nếu cần → các migration mới. Production dùng initializer không có demo như hướng dẫn đầu trang.

File `conference_updates.sql` có thể chạy lại, giữ nguyên giờ tổ chức đã lưu; phần cuối chuẩn hóa lĩnh vực/chủ đề của 10 hội thảo mẫu theo ID và đồng bộ quyền xem bài báo theo từng hội thảo. Sau đó luôn áp dụng các migration mới theo README.

`create_author_accounts.sql` chỉ phục vụ thử nghiệm tài khoản mẫu. Production tạo tài khoản qua Supabase Auth và không dùng mật khẩu demo chung.

Không chạy lại file khởi tạo trên database đang sử dụng vì có phần đặt lại tài khoản và dữ liệu demo. File dữ liệu mẫu cũng đặt lại lịch, trạng thái và thông tin mẫu; chỉ chạy khi muốn nạp lại dữ liệu demo.

Các bản vá có ngày đã được gộp thành từng khối `BEGIN SECTION`/`END SECTION`. Giữ các dấu này để kiểm thử có thể đọc đúng khối SQL. Các file SQL trong `../tests/` chỉ phục vụ kiểm thử, không phải file triển khai.

Để chỉ bổ sung hội thảo đa lĩnh vực, chạy riêng khối `multidisciplinary_demo` cuối file dữ liệu mẫu. Khối này thêm 12 hội thảo và 24 bài báo giả lập (2 bài/hội thảo), cập nhật phần giới thiệu hội thảo và tóm tắt bài báo đã có, không tạo trùng khi chạy lại. Bài báo mới có tiêu đề, tóm tắt và từ khóa, chưa đính kèm PDF.

Sau các migration trên, chạy `20261009_certificate_consistency.sql`: chặn cấp cho hội thảo hủy, kiểm tra toàn bộ danh sách cấp tham dự trước khi ghi, chống cấp trùng và lưu thời lượng đo được. Chứng nhận báo cáo dùng RPC riêng theo từng bài.

Database hiện tại chưa rõ đã chạy cập nhật nào: có thể chạy toàn bộ `upgrade_existing_database.sql` trong SQL Editor. File gộp các migration nền và mới theo thứ tự, trong một giao dịch, không chứa initializer hoặc dữ liệu demo; cuối file yêu cầu PostgREST tải lại schema.


Bản sửa độ tin cậy: áp dụng `20261010_email_delivery_safety.sql` sau các migration trước đó, hoặc chạy lại bundle `upgrade_existing_database.sql`. Migration bổ sung trạng thái email cần đối chiếu và quyền dọn file chưa được sử dụng. Sau đó triển khai lại function `post-seminar`; không cập nhật worker trước schema.


Dọn file bỏ dở: xem [UPLOAD_CLEANUP.md](../UPLOAD_CLEANUP.md). Migration `20261010_orphan_upload_cleanup.sql` đã nằm trong bundle nâng cấp; cần deploy function `upload-cleanup` riêng để thực hiện dọn file.


Nâng cấp local mới: áp dụng `20261011_local_improvements.sql` sau bundle đến 20261010 để bật QR tra cứu, thu hồi chứng nhận, phiên bản phản biện và bảo vệ nhật ký. Kiểm thử tài khoản và vận hành: [OPERATIONS.md](../../docs/OPERATIONS.md).
