# Thống kê & Báo cáo

Áp dụng `migrations/conference_updates.sql` trong Supabase SQL Editor để bật ghi nhận hủy đăng ký và camera-ready. Migration không sửa trạng thái nghiệp vụ cũ và không suy đoán lịch sử đã mất. Tài khoản admin mở tab **Thống kê & Báo cáo** rồi bấm **Làm mới**.

## Phạm vi và cách tính

- Khoảng ngày gồm cả hai đầu, theo múi giờ của thiết bị. 7/30 ngày tính đến hôm nay; 3 tháng gồm tháng hiện tại và hai tháng trước đến hôm nay; Năm nay tính từ 01/01.
- Chọn hội thảo và trạng thái hiện tại để xác định phạm vi. Số hội thảo tính theo ngày bắt đầu; bài theo ngày tạo; đăng ký theo ngày đăng ký; chứng nhận theo ngày cấp. Một hội thảo bắt đầu ngoài kỳ vẫn có thể có bài hoặc đăng ký phát sinh trong kỳ.
- Tổng người dùng và phân bố vai trò tính trên toàn bộ tài khoản hiện tại, độc lập với các bộ lọc. Số tài khoản mới và bảng tài khoản theo tháng chỉ tính tài khoản được tạo trong kỳ.
- Check-in là trạng thái hiện tại của các lượt đăng ký trong kỳ, không phải số thao tác check-in diễn ra trong kỳ. Dữ liệu chưa lưu thời điểm check-in.
- Review tính cho các bài nộp trong kỳ. Quá hạn là review chưa hoàn thành và đã qua `review_deadline` tại thời điểm xem; là tập con của review đang chờ. Trung bình thời gian tính từ `assigned_at` đến `completed_at`, loại mốc thiếu hoặc âm.
- Camera-ready là trạng thái báo cáo dẫn xuất: bài còn `accepted` và có phiên bản mới nộp sau khi chấp nhận, được trigger ghi nhận sau migration. Mỗi bài chỉ đếm một lần, tách khỏi nhóm Accepted trên biểu đồ. Tỷ lệ Accept vẫn bao gồm camera-ready, chia cho tổng bài Accepted + Camera-ready + Rejected.
- Lượt hủy đếm theo ngày hủy; hủy rồi đăng ký lại là hai hoạt động riêng. Không coi xóa dây chuyền hội thảo/tài khoản là hủy đăng ký.
- Chứng nhận còn thiếu kiểm tra mọi chứng nhận attendance hiện có cho từng cặp hội thảo/người tham dự đã check-in trong nhóm đăng ký của kỳ. Chứng nhận presentation không thay cho attendance.
- Trung bình đăng ký/hội thảo lấy lượt đăng ký trong kỳ chia cho số hội thảo thuộc phạm vi chọn, kể cả hội thảo chưa có đăng ký.
- CSV xuất bộ lọc đã áp dụng, tổng quan, mọi nhóm chỉ số, số liệu tháng và toàn bộ bảng xếp hạng. Có BOM UTF-8, escape dấu nháy và vô hiệu hóa công thức từ dữ liệu văn bản.

## Kiểm tra

`node --test supabase/tests/report-analytics.test.mjs` kiểm tra ranh giới ngày, lọc dữ liệu, không đếm trùng camera-ready, thời gian phản biện, chứng nhận, thiếu dữ liệu và CSV.

`npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build` kiểm tra frontend. Cần chạy migration trên môi trường kiểm thử và kiểm tra thêm thao tác hủy đăng ký, nộp phiên bản sau Accept cùng quyền đọc lịch sử admin trên Supabase thật.

`tests/reporting.sql` kiểm tra trigger hủy đăng ký/camera-ready và quyền đọc/ghi lịch sử bằng fixture trong transaction rồi rollback. Chạy trên database kiểm thử sau khi áp dụng migration; không phải kiểm thử đã chạy tự động bởi frontend.
