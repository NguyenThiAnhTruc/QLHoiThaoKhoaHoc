# Kết quả rà soát ngày 10/10/2026

Phạm vi hiện tại: dùng trên localhost trước, chưa triển khai VPS.

## Đã sửa

- Tách truy vấn hồ sơ khỏi callback xác thực để tránh chờ khóa phiên Supabase.
- Chặn kết quả hồ sơ cũ ghi vào phiên đăng nhập mới; giới hạn thời gian tải hồ sơ; thêm màn hình lỗi với Thử lại và Đăng xuất.
- Xử lý lỗi mạng khi đăng nhập, đăng ký và khôi phục mật khẩu, giải phóng trạng thái đang gửi khi lỗi.
- Modal có role/nhãn truy cập, quản lý focus, phím Escape và khóa cuộn nền.
- Sửa lỗi mẫu chứng nhận bị in thành hai trang: kiểm tra template, chứng nhận tham dự và chứng nhận báo cáo bằng Chrome print-to-PDF.
- Thêm lệnh kiểm tra tổng hợp, kiểm tra UI, schema và công cụ tạo lại SQL gộp để tránh lệch migration.

## Đã kiểm tra

- TypeScript, ESLint và build.
- Bộ kiểm thử nghiệp vụ: phân quyền, nộp bài nguyên tử, phản biện, đăng ký, phiên song song, tài liệu, khảo sát, chứng nhận, PDF/email giả lập, báo cáo và SQL nâng cấp.
- Chrome thực: trang công khai và form đăng nhập ở 1440px và 390px không tràn ngang, ảnh con dấu tải được.
- Menu và render trang với dữ liệu rỗng của admin, organizer, author, reviewer, participant dùng API giả lập cách ly; không gửi thao tác ghi lên backend thật.
- Modal tạo hội thảo nhận focus, khóa cuộn và đóng bằng Escape. Lỗi tải hồ sơ hiện rõ; Thử lại khôi phục giao diện.
- Bản in mẫu, chứng nhận tham dự/báo cáo với dữ liệu kiểm tra đều có một trang A4; không có runtime exception trong bài kiểm tra UI.

## Còn thiếu trên backend thật

Kiểm tra chỉ đọc Supabase vẫn báo thiếu conferences.review_enabled, papers.problem_statement, sessions.parent_session_id, conference_resources, session_feedback, certificates.attendance_minutes.

Cần chạy upgrade_existing_database.sql rồi kiểm tra lại schema. Chưa có DATABASE_URL để áp dụng trực tiếp và chưa deploy Edge Functions trong lần rà soát này.

Kiểm thử trình duyệt có API giả lập không thay thế nghiệm thu CRUD bằng tài khoản thật trên schema đã cập nhật. Gmail OAuth, cron/Vault, Auth redirects và tải PDF qua Edge Functions cần xác nhận trên Supabase thực. Chữ ký số vẫn chưa triển khai; mã đối chiếu và ảnh con dấu không phải chữ ký số.

Hướng dẫn dùng local: LOCAL_SETUP.md. Khi chuyển sang VPS, cần bổ sung cấu hình host/domain/HTTPS và kiểm thử môi trường thật.

## Rà soát tình huống lỗi bổ sung

Đã sửa: làm mới token hoặc sự kiện đăng nhập lặp lại cùng tài khoản không tháo giao diện/form khi hồ sơ đã tải; Chrome kiểm thử bằng sự kiện BroadcastChannel và xác nhận bản nháp còn nguyên. Khôi phục phiên có giới hạn chờ; đăng xuất thất bại báo lỗi thay vì tự báo đã thoát.

Danh sách bài báo, người tham dự, chứng nhận và người đủ điều kiện cấp hàng loạt dùng phân trang có thứ tự ổn định để vượt giới hạn bản ghi API. Không trả danh sách một phần khi trang tiếp theo lỗi. Kiểm thử helper với 1.203 bản ghi và giới hạn server 100 bản ghi đã đạt.

Cấp chứng nhận xử lý Promise bị từ chối khi tải người nhận; trình duyệt chặn popup in có thông báo. Cập nhật hội thảo yêu cầu server trả bản ghi đã sửa, tránh báo thành công khi bản ghi đã mất hoặc quyền đã thay đổi.

Các điều kiện còn phải xác minh trước sử dụng thực tế: Supabase schema còn thiếu; Edge Functions/OAuth/cron chưa nghiệm thu thực; mất kết nối ngay sau thao tác ghi có thể khiến trạng thái kết quả chưa rõ; email có thể gửi trùng nếu provider nhận nhưng cập nhật trạng thái thất bại; upload file thành công nhưng lưu metadata thất bại có thể để lại file không được tham chiếu. Các giới hạn này chưa được khẳng định đã xử lý hoàn toàn. Nghiệm thu tài khoản thật, mạng chậm/mất mạng, dữ liệu lớn và tải đồng thời cần thực hiện sau cập nhật backend.


## Sửa bổ sung độ tin cậy
- Email ghi marker bền vững trước khi gửi; lỗi sau marker chuyển `uncertain`, không tự gửi lại. Có thể cần đối chiếu thủ công khi worker dừng trước khi thực sự gửi.
- Khoản phí và tài liệu dùng ID ổn định và truy vấn xác nhận khi mất phản hồi. Tài liệu tái sử dụng file đã tải trong lần thử lại.
- Lưu metadata thất bại: yêu cầu Storage API xóa file; policy chỉ cho chủ sở hữu xóa file không được tham chiếu. Khóa transaction phối hợp với trigger insert ngăn xóa file đang được lưu đồng thời.
- Đã bổ sung worker `upload-cleanup` cho file bỏ dở hơn 24 giờ. Reservation và khóa transaction bảo vệ file được tham chiếu và thao tác lưu đồng thời. Cần deploy function và bật lịch theo `supabase/UPLOAD_CLEANUP.md`; chưa kích hoạt trên Supabase thật.
- Chưa áp dụng migration lên Supabase thật: môi trường không có DATABASE_URL. SQL đã được gộp trong bundle nâng cấp.


## Sửa luồng local sau khi cập nhật schema
- Tạo hội thảo dùng ID ổn định và xác nhận bản ghi sau mất phản hồi; ảnh bìa đã tải được tái sử dụng khi thử lại trong cùng form.
- Tải form chỉnh sửa có xử lý lỗi và hủy phản hồi cũ; tải trạng thái email có catch/finally, báo đang tải riêng và không hiển thị số liệu của hội thảo trước.
- Người dùng yêu cầu bỏ qua triển khai Edge Functions. Gửi email tự động và dọn file theo lịch vẫn chưa được kích hoạt.
