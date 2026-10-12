# Rà soát logic chức năng

Các kết quả dưới đây được kiểm tra bằng SQL/TypeScript của dự án, database PostgreSQL tạm và giao diện với API giả lập. Kiểm tra Supabase thật xác nhận schema; không thay thế kiểm thử nghiệp vụ với tài khoản thật.

| Chức năng | Quy tắc đã có kiểm thử |
| --- | --- |
| Phân quyền | Chủ bài mới sửa bài; người phản biện không sửa bài tác giả; người ngoài không đọc chứng nhận; người tham dự không được cấp/thu hồi chứng nhận; không gọi RPC ghi nhật ký tùy ý |
| Nộp bài | Metadata, tác giả, chủ đề và phiên bản lưu cùng transaction; dữ liệu không hợp lệ rollback; thử lại cùng ID không tạo phiên bản trùng; chặn sửa quá hạn và bản chỉnh sửa cũ |
| Phản biện | Phải nhận phân công trước khi chấm; từ chối cần lý do; chặn tác giả đồng thời làm phản biện cùng bài; hoàn thành cần nhận xét và đề xuất; chặn sửa bản đánh giá cũ |
| Quyết định bài | Chuyển đúng thứ tự; hội thảo có phản biện cần phản biện hoàn thành; chỉ ban tổ chức ra quyết định; không thay đổi quyết định cuối tùy ý |
| Đăng ký | Kiểm tra trạng thái, hạn, sức chứa và điều kiện bài được chấp nhận; có cơ chế khóa hàng và bộ đếm trong SQL. Chưa xác nhận tranh chấp hai kết nối trên Supabase thật |
| Lịch trình | Phiên thuộc đúng hội thảo; kết thúc sau bắt đầu; báo cáo nằm trong phiên chung; chỉ lập lịch cho bài đã chấp nhận; nhóm phiên chồng giờ và qua ngày được kiểm tra |
| Điểm danh | Mã phải thuộc hội thảo; đối chiếu trạng thái cũ khi cập nhật; thời lượng phiên giới hạn trong giờ phiên và gộp khoảng trùng; không suy đoán giờ ra còn thiếu |
| Tài liệu | Quyền tải theo công khai/đăng ký/điểm danh; hạn tải lên của diễn giả; file đã được tham chiếu không bị dọn nhầm |
| Kinh phí | Minh chứng phải tồn tại; quỹ thuộc đúng hội thảo; người nộp không tự duyệt; file minh chứng có quyền riêng |
| Khảo sát | Phải có điểm danh phiên thực tế và phiên đã kết thúc; mỗi người trả lời một lần |
| Chứng nhận | Người đủ điều kiện, hội thảo đã kết thúc; chặn hội thảo hủy; báo cáo gắn đúng bài; cấp hàng loạt atomic và thử lại an toàn; thu hồi có quyền và nhật ký; tra cứu không báo chứng nhận thu hồi là hợp lệ |
| Xuất dữ liệu | CSV/XML giữ tiếng Việt, xử lý dấu nháy/xuống dòng và tránh diễn giải dữ liệu người dùng thành công thức |

## Lỗi sửa trong lượt rà soát này

- Phản biện và lịch trình bị cắt theo giới hạn dòng API: chuyển sang tải từng batch có thứ tự ổn định.
- Danh sách bài liên quan tới phản biện có thể tạo URL quá dài hoặc bị cắt dữ liệu: chia bộ lọc ID thành nhóm 100, mỗi nhóm vẫn xử lý giới hạn dòng API.
- Lỗi mạng ở batch sau có thể làm promise bị từ chối và giữ spinner: helper trả lỗi có kiểm soát và không công bố phần dữ liệu tải dở.
- Tạo phiên sau mất phản hồi có thể tạo trùng: dùng ID ổn định và truy vấn xác nhận bản ghi trước khi coi thao tác thất bại.
- Cập nhật/xóa phiên không tác động bản ghi vẫn có thể báo thành công: yêu cầu bản ghi trả về, xử lý lỗi khi không có.
- Phản hồi tải lịch trình/phản biện cũ có thể ghi đè lần tải mới: thêm số thứ tự request.

## Kết quả và giới hạn

- 109 kiểm thử nghiệp vụ/helper/SQL đạt; TypeScript, ESLint và build đạt.
- 9 mục schema Supabase thật đạt, gồm chứng nhận và revision phản biện.
- Chưa có file tài khoản thử trên máy, nên chưa chạy `verify:live-workflow` và chưa xác nhận quy trình hoàn chỉnh trên Supabase thật.
- Tác vụ email và dọn file theo lịch chưa triển khai theo lựa chọn trước đó; backup/restore thực tế và giám sát lỗi tập trung chưa được xác nhận.
- Phân trang giao diện vẫn tải toàn bộ dữ liệu theo batch; chưa tối ưu thành phân trang truy vấn phía server cho dữ liệu rất lớn.

Chạy `npm run check`, `npm run verify:ui`, `npm run verify:schema` để lặp lại các kiểm tra. Sau khi cấu hình tài khoản thử bằng `scripts/configure-live-test.ps1`, dùng `npm run verify:live-access` và `npm run verify:live-workflow` cho bước xác nhận thật.
