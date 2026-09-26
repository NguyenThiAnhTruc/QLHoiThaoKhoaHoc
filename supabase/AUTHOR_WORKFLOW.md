# Hoàn thiện luồng tác giả

## Cập nhật database đang sử dụng

Chạy toàn bộ `migrations/20260925_author_workflow.sql` trong Supabase SQL Editor,
sau các migration hiện có. Sau khi thành công, triển khai frontend cùng phiên bản này.
Không chạy lại file SQL tổng trên database đang có dữ liệu để thay thế migration.

Database mới: phần cuối `migrations/conference_management_supabase.sql` đã chứa
cùng bản cập nhật. Migration tác giả có thể chạy lại an toàn.

## Hành vi

- Người nộp bài có nút **Sửa / nộp bản mới** tại trang chi tiết; bài được chấp nhận
  có nút **Nộp bản hoàn thiện**. Đồng tác giả có quyền xem, không thay người nộp chỉnh sửa.
- Tiêu đề, tóm tắt và file bài báo là bắt buộc trong luồng lưu mới. PDF tối đa 15 MB.
  Hội thảo phản biện ẩn danh yêu cầu upload PDF; hội thảo khác có thể dùng URL HTTP/HTTPS.
- `save_paper_submission` lưu bài, đồng tác giả và phiên bản trong một giao dịch,
  có RLS. Nếu bất kỳ bước nào lỗi, toàn bộ thay đổi database được rollback.
  Storage upload diễn ra trước giao dịch: file upload nhưng chưa gắn vào bài có thể
  còn trong Storage nếu tác giả hủy hoặc lưu thất bại; được phép xóa file chưa sử dụng.
- Upload file mới hoặc đổi URL đều ghi phiên bản mới. Chỉ đổi nội dung không tạo
  thêm phiên bản. UUID của bài được giữ khi thử lại thao tác tạo bài trong cùng form.
  Khi bài đã thay đổi từ một phiên khác, form yêu cầu tải lại trước khi lưu.
- File đã được bài hoặc lịch sử phiên bản tham chiếu không thể bị ghi đè/xóa qua
  API người dùng. Muốn sửa phải nộp file mới. URL ngoài hệ thống không đảm bảo
  nội dung bất biến; nên dùng upload PDF nếu cần lưu trữ phiên bản chính xác.
- Hạn sửa là `submission_deadline`; với bài `accepted`/`revision_required` dùng
  `camera_ready_deadline`. Bài bị từ chối, hội thảo hủy hoặc hoàn thành bị khóa
  đối với người nộp. Quản trị viên/BTC phụ trách vẫn được quản lý.
- Danh sách đồng tác giả loại người đang phản biện bài; database cũng kiểm tra
  xung đột và khóa bản ghi bài để phối hợp các thay đổi đồng tác giả/phân công.
- Đổi trạng thái bài hoặc hoàn thành phản biện tạo thông báo nội bộ cho người nộp
  và đồng tác giả, theo tùy chọn `reviews` trong hồ sơ. Nộp bản mới không tự đổi
  quyết định của BTC hoặc tự mở lại phản biện đã hoàn thành.
- Chuông hiển thị thông báo đã lưu, cập nhật khi mở và mỗi 30 giây. Thông báo lỗi
  tải dữ liệu được phân biệt với danh sách trống. Toast thao tác vẫn là phản hồi tạm.
- Thông báo kết quả này là **thông báo nội bộ**, không tự gửi Gmail. Hàm Gmail
  dùng chung đã sửa lỗi cú pháp; nếu đang triển khai hàm đó, cần deploy lại riêng.

## Kiểm tra

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run build
```

`supabase/tests/author-workflow.test.mjs` chạy PostgreSQL bằng PGlite trong bộ nhớ,
nạp bảng, RLS, hàm và trigger từ SQL thật. Các schema do Supabase quản lý
(`auth`, `storage`) được mô phỏng tối thiểu; không truy cập database từ xa.
Kiểm tra gồm rollback, quyền chủ bài/đồng tác giả/reviewer, hạn chỉnh sửa,
phiên bản URL/PDF, camera-ready, thông báo và bảo vệ file cũ.

Sau khi áp dụng migration trên Supabase, kiểm tra giao diện với tài khoản tác giả:
1. Nộp PDF và thêm đồng tác giả, mở chi tiết để xem phiên bản 1.
2. Sửa nội dung, nộp file mới, kiểm tra phiên bản 2 và file cũ còn xem được.
3. BTC yêu cầu chỉnh sửa/chấp nhận bài; tác giả và đồng tác giả nhận thông báo.
4. Nộp bản hoàn thiện, kiểm tra phiên bản và dữ liệu báo cáo camera-ready.
5. Thử bài quá hạn và tài khoản đồng tác giả: không có nút sửa, API từ chối sửa.
