# ConfManager — Tài liệu tổng hợp chức năng và quy trình vận hành

> Tài liệu này mô tả phiên bản hiện có của dự án **ConfManager — Quản lý hội
> thảo khoa học**: hệ thống làm gì, người dùng thao tác như thế nào, dữ liệu
> được lưu và kiểm soát ra sao, cách triển khai, kiểm thử và các giới hạn cần
> biết.

## 1. Tổng quan dự án

ConfManager là ứng dụng web quản lý toàn bộ vòng đời của một hội thảo khoa học:

1. Công khai thông tin hội thảo và tiếp nhận người tham dự.
2. Tiếp nhận bài báo, đồng tác giả, chủ đề và các phiên bản bài nộp.
3. Phân công và thực hiện phản biện.
4. Quyết định bài được chấp nhận, từ chối hoặc yêu cầu sửa.
5. Lập lịch phiên khai mạc, báo cáo, bế mạc; gắn bài báo vào tiểu ban.
6. Quản lý đăng ký, điểm danh, tài liệu hội thảo và khảo sát sau phiên.
7. Thu kinh phí, nhận minh chứng và duyệt khoản nộp.
8. Cấp, xác nhận, tải, tra cứu và thu hồi chứng nhận.
9. Gửi thông báo nội bộ, email Gmail và cung cấp báo cáo quản trị.

### Công nghệ

- **Frontend:** React 18, TypeScript, Vite, Tailwind CSS.
- **Backend:** Supabase Auth, PostgreSQL, Row Level Security (RLS), Storage và
  Edge Functions.
- **Tài liệu/PDF:** `pdf-lib`, font Noto Sans đóng gói cho Edge Function.
- **QR:** `@zxing/browser` để quét camera và `qrcode` để tạo mã.
- **Kiểm thử:** Node test runner, PGlite/PostgreSQL giả lập, kiểm tra schema,
  kiểm tra UI headless và kiểm thử workflow API thật tùy môi trường.

Mã nguồn frontend nằm trong [src/](../src/). Schema, migration, Edge Function
và kiểm thử backend nằm trong [supabase/](../supabase/).

## 2. Cách hệ thống hoạt động

### 2.1. Kiến trúc xử lý

```text
Trình duyệt
  ├─ React pages/components
  ├─ AuthContext và RouterContext
  └─ Supabase client (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)
          │
          ├─ Supabase Auth: đăng nhập, đăng ký, OAuth Google, khôi phục mật khẩu
          ├─ PostgREST/RPC: dữ liệu nghiệp vụ và kiểm tra quyền bằng RLS
          ├─ Storage: ảnh, PDF, tài liệu, minh chứng và PDF chứng nhận
          └─ Edge Functions: tải PDF ẩn danh, Gmail, tự động sau hội thảo,
             dọn file upload bỏ dở
```

Frontend không được chứa `service_role key`. Các thao tác cần quyền đặc biệt
được kiểm tra ở database hoặc thực hiện phía server bằng Edge Function.

### 2.2. Đăng nhập và tải hồ sơ

1. Người dùng đăng nhập bằng email/mật khẩu hoặc Google OAuth.
2. Supabase trả về session/JWT.
3. Ứng dụng tải bản ghi tương ứng trong `profiles`.
4. Vai trò trong `profiles.role` quyết định menu và màn hình.
5. Nếu tải hồ sơ lỗi, ứng dụng hiển thị lỗi rõ ràng, cho phép thử lại hoặc đăng
   xuất; không coi lỗi tải dữ liệu là danh sách rỗng.
6. Có luồng gửi email khôi phục mật khẩu và đặt mật khẩu mới.

### 2.3. Điều hướng

Ứng dụng dùng router nội bộ trong [RouterContextCore.ts](../src/context/RouterContextCore.ts)
thay vì phụ thuộc một router ngoài. Các trang chính gồm:

- Tổng quan, hội thảo, kinh phí.
- Bài báo, chi tiết bài báo, phản biện.
- Lịch trình, chi tiết phiên, báo cáo của tôi, kho tài liệu.
- Chứng nhận, tin nhắn, tài khoản và hồ sơ/cài đặt.
- Cổng công khai và trang tra cứu chứng nhận bằng token QR.

Form tạo/sửa hội thảo và bài báo được mở trong modal; sau khi lưu, trang cha
được tải lại để phản ánh dữ liệu mới.

## 3. Vai trò và phạm vi quyền

| Vai trò | Mục đích chính | Quyền nghiệp vụ tiêu biểu |
|---|---|---|
| **Admin** | Quản trị toàn hệ thống | Quản lý tài khoản/vai trò, hội thảo, báo cáo, audit log, gửi Gmail, can thiệp dữ liệu theo quyền quản trị |
| **Organizer / Ban tổ chức** | Điều hành hội thảo được phụ trách | Tạo/sửa hội thảo, quản lý staff, bài, phản biện, lịch, điểm danh, tài liệu, chứng nhận, kinh phí |
| **Reviewer / Phản biện** | Đánh giá bài được giao | Nhận hoặc từ chối phân công, gửi đánh giá, xem bài trong phạm vi được phép |
| **Author / Tác giả** | Nộp và theo dõi bài | Nộp bài, quản lý đồng tác giả, sửa/nộp phiên bản, xem kết quả, tham dự và báo cáo |
| **Participant / Người tham dự** | Khám phá và tham dự | Xem hội thảo công khai, đăng ký, điểm danh, xem lịch/tài liệu và nhận chứng nhận nếu đủ điều kiện |

Quyền không chỉ nằm ở menu frontend. RLS, RPC và các trigger database tiếp tục
kiểm tra người gọi, hội thảo được phụ trách, thời hạn và trạng thái bản ghi.
Một tài khoản có thể có quyền staff tại hội thảo này nhưng không được thao tác
trên hội thảo khác.

## 4. Vòng đời hội thảo

### 4.1. Tạo hội thảo

Admin hoặc người dùng có quyền tổ chức mở **Hội thảo → Tạo hội thảo mới** và
nhập:

- Tên, mô tả, địa điểm, ngày bắt đầu/kết thúc, hình thức online/offline/hybrid.
- Ảnh bìa (ảnh tối đa 5 MB).
- Sức chứa và hạn đăng ký.
- Hạn nộp bài, hạn phản biện, hạn camera-ready.
- Lĩnh vực và các chủ đề.
- Bật/tắt phản biện; yêu cầu bài accepted trước khi đăng ký.
- Tự động cấp chứng nhận và tự động gửi khảo sát sau hội thảo.
- Có công khai lịch hay không, có nổi bật hay không.
- Thông tin liên hệ.

Frontend kiểm tra ngày, lĩnh vực và chủ đề. Database tiếp tục kiểm tra quan hệ
và quyền khi ghi.

### 4.2. Trạng thái hội thảo

| Mã | Ý nghĩa |
|---|---|
| `draft` | Bản nháp; dùng ở database nhưng form hiện tại không cho chọn khi tạo mới |
| `open` | Mở đăng ký/nộp bài theo các hạn cấu hình |
| `closed` | Đã đóng đăng ký hoặc đã qua hạn đăng ký |
| `ongoing` | Đang diễn ra |
| `completed` | Đã kết thúc |
| `cancelled` | Đã hủy; khóa các thao tác nghiệp vụ của người dùng |

Trạng thái hiển thị còn được suy ra từ ngày hiện tại, ngày đăng ký và trạng thái
được lưu. Vì vậy một hội thảo có thể tự hiển thị `closed`, `ongoing` hoặc
`completed` dù trạng thái cũ chưa được cập nhật thủ công.

### 4.3. Staff và chuyển chủ

Chủ hội thảo có thể thêm nhân sự ban tổ chức/ban thư ký. Admin hoặc chủ hiện tại
có thể chuyển chủ sang tài khoản phù hợp. Database kiểm tra xung đột khi chủ đã
bị người khác thay đổi và ghi audit log trong cùng transaction.

Staff có thể quản lý bài, lịch, điểm danh và chứng nhận trong phạm vi hội thảo.
Các thao tác quản trị tài khoản và chuyển chủ cấp hệ thống vẫn thuộc admin/chủ
theo chính sách tương ứng.

## 5. Quy trình bài báo khoa học

### 5.1. Nộp bài

Tác giả mở **Bài báo khoa học → Nộp bài mới**, chọn hội thảo còn mở và điền:

- Tiêu đề, tóm tắt, từ khóa.
- Vấn đề nghiên cứu, mục tiêu và nhóm tác giả.
- Tác giả chính/tác giả liên hệ.
- Danh sách đồng tác giả, thứ tự và trạng thái tham gia.
- Chủ đề của hội thảo.
- PDF hoặc URL HTTP/HTTPS.
- Ghi chú phiên bản.

Trong hội thảo phản biện ẩn danh, bài phải dùng PDF upload vào hệ thống. PDF
cần được tác giả loại bỏ tên/thông tin nhận diện trong nội dung và metadata;
hệ thống không tự biên tập nội dung PDF. PDF tối đa 15 MB.

### 5.2. Lưu nhất quán

RPC `save_paper_submission` lưu bài, tác giả, chủ đề và phiên bản trong một
transaction. Nếu một bước thất bại, các thay đổi database được rollback.
Upload Storage xảy ra trước transaction nên file upload nhưng chưa gắn vào
bản ghi có thể tồn tại tạm thời; worker `upload-cleanup` xử lý loại file bỏ dở
được phép dọn.

Form dùng một UUID ổn định cho lần thử tạo bài, giúp retry không tạo bài trùng.
Khi phát hiện bài đã thay đổi ở phiên khác, người dùng phải tải lại trước khi
ghi tiếp.

### 5.3. Phiên bản và sửa bài

- Upload PDF mới hoặc đổi URL tạo phiên bản mới.
- Chỉ đổi metadata không tạo phiên bản file mới.
- File đã được bài hoặc lịch sử phiên bản tham chiếu không bị ghi đè/xóa qua API.
- Đồng tác giả được xem bài nhưng không thay người nộp chỉnh sửa.
- Bài `accepted` hoặc `revision_required` có thể nộp bản camera-ready nếu còn hạn.
- Bài `rejected`, hội thảo đã hủy hoặc đã hoàn thành không cho tác giả sửa.

Hạn sửa là `submission_deadline`; với bài đã accepted hoặc cần sửa là
`camera_ready_deadline`. Quyền thực tế còn được kiểm tra bởi
`can_edit_paper_submission`.

### 5.4. Trạng thái bài

| Trạng thái | Ý nghĩa | Chuyển tiếp thông thường |
|---|---|---|
| `submitted` | Đã nộp, chờ phân công | `under_review` khi có phân công |
| `under_review` | Đang phản biện | `accepted`, `rejected` hoặc `revision_required` khi đủ kết quả |
| `accepted` | Được chấp nhận | Có thể nộp camera-ready |
| `revision_required` | Cần sửa | `under_review` sau khi nộp bản sửa |
| `rejected` | Bị từ chối | Không mở lại qua luồng tác giả |

Nếu tắt phản biện, ban tổ chức có thể quyết định trực tiếp từ bài đang chờ,
đang phản biện hoặc cần sửa. Nếu bật phản biện, database chặn quyết định khi
chưa có review hoàn thành.

### 5.5. Bảo vệ phản biện ẩn danh

`read_papers` và các RPC catalog trả dữ liệu theo người gọi. Người ngoài nhóm
tác giả/nhóm quản lý không nhìn thấy danh tính tác giả hoặc đường dẫn Storage
chứa ID tác giả. Reviewer tải PDF qua Edge Function `paper-download`; function
kiểm tra JWT và quyền đọc trước khi dùng service role lấy file.

## 6. Quy trình phản biện

1. Admin hoặc ban tổ chức chọn reviewer và phân công bài.
2. Reviewer mở **Phản biện được giao**.
3. Reviewer chọn **Nhận phản biện** hoặc **Từ chối phân công**, trong trường hợp
   từ chối phải nhập lý do.
4. Nhận việc chuyển `assigned` → `in_progress`; từ chối chuyển
   `assigned` → `declined`.
5. Chỉ reviewer đã nhận việc mới được gửi đánh giá.
6. Đánh giá gồm điểm tổng, các điểm thành phần, nhận xét và khuyến nghị
   `accept`, `reject` hoặc `revise`.
7. Khi gửi, database ghi `completed_at`, khóa kết quả đã hoàn thành và thông báo
   cho người có liên quan.
8. Ban tổ chức căn cứ kết quả để chấp nhận, từ chối hoặc yêu cầu sửa.

Reviewer chỉ thấy nhiệm vụ của mình; tác giả/đồng tác giả và admin/ban tổ chức
phụ trách được xem các review liên quan theo chính sách. Phân công từ chối
được giữ lại lịch sử nhưng không tính là việc đang chờ. Muốn mời lại cùng
reviewer, phải xóa phân công cũ có xác nhận rồi tạo phân công mới; lịch sử
phản hồi cũ vẫn được giữ.

## 7. Đăng ký, điểm danh và tham dự

### 7.1. Đăng ký hội thảo

Người dùng xem hội thảo công khai hoặc đăng nhập để đăng ký. Hệ thống kiểm tra:

- Hội thảo đang mở và chưa quá hạn đăng ký.
- Sức chứa và số chỗ còn lại.
- Người dùng chưa đăng ký trước đó.
- Nếu hội thảo bật `require_accepted_paper`, người đăng ký phải có bài accepted.

Việc giữ chỗ dùng logic database để chống đăng ký vượt sức chứa khi nhiều request
đến đồng thời. Đăng ký không tự đặt `attended = true`.

Người dùng có thể hủy đăng ký khi chính sách/trạng thái cho phép. Hủy được ghi
nhận để phục vụ báo cáo; đăng ký lại được tính là hoạt động mới.

### 7.2. Điểm danh hội thảo

Ban tổ chức tạo phiên điểm danh gồm thời gian bắt đầu/kết thúc và mã QR/mã nhập.
Người tham dự phải đăng ký trước, sau đó quét QR bằng camera hoặc nhập mã.
Staff chỉ được điểm danh trong hội thảo mình phụ trách.

Điểm danh là điều kiện quan trọng cho chứng nhận attendance và các quyền sau
hội thảo. Hệ thống bảo vệ thao tác quét lặp và không cho người chưa đăng ký
được đánh dấu tham dự.

### 7.3. Điểm danh từng phiên

Ngoài điểm danh hội thảo, mỗi phiên có thể có QR riêng. Người tham dự phải có
đăng ký và đã điểm danh hội thảo trước khi ghi nhận vào/ra phiên. Thời lượng
tham dự được tính từ khoảng vào/ra, giới hạn trong thời gian phiên và gộp các
khoảng trùng.

## 8. Lịch trình, tiểu ban, diễn giả và tài liệu

### 8.1. Cấu trúc lịch

Hội thảo có các loại phiên:

- `opening`: khai mạc.
- `reporting`: phiên báo cáo; bắt buộc thuộc tiểu ban.
- `closing`: bế mạc.

Tiểu ban gắn với một chủ đề. Một phiên báo cáo có thể gắn bài accepted, phòng,
thời gian, diễn giả, chủ trì và thư ký. Database kiểm tra:

- Tiểu ban thuộc đúng hội thảo.
- Phiên báo cáo có tiểu ban.
- Bài được gắn đã accepted và thuộc chủ đề của tiểu ban.
- Diễn giả là tác giả của bài.
- Chủ trì/thư ký thuộc chủ hội thảo hoặc staff của hội thảo.

Giao diện có lịch theo ngày/phòng, tìm theo diễn giả/chủ đề/mức độ và lịch
riêng của tác giả trong **Lịch của tôi**.

### 8.2. Diễn giả

Ban tổ chức quản lý tên, chức danh, đơn vị, tiểu sử, ảnh, trạng thái keynote
và thứ tự hiển thị. Người dùng có thể xem trang diễn giả theo phạm vi được
công khai.

### 8.3. Kho tài liệu

Ban tổ chức tải tài liệu PDF/PPT/PPTX trước hạn và chọn phạm vi:

- Công khai.
- Chỉ người đã đăng ký.
- Chỉ người đã điểm danh.

Bucket tài liệu là private. Quyền tải được kiểm tra ở server, không chỉ dựa
vào việc ẩn nút trên frontend. Người báo cáo xem tài liệu của phiên/bài mình
được phép.

### 8.4. Khảo sát

Sau khi phiên kết thúc, người đã điểm danh được trả lời khảo sát một lần.
Ban tổ chức xem điểm tổng hợp; câu trả lời cá nhân không công khai. Tác vụ
gửi email khảo sát là tùy chọn và mặc định tắt.

## 9. Kinh phí và minh chứng thanh toán

Ban tổ chức tạo các quỹ/khoản phí cho hội thảo, gồm tên, số tiền và mô tả.
Người nộp gửi khoản thanh toán với số tiền, mục đích và minh chứng:

- PDF/ảnh tối đa 10 MB trong bucket private `fee-proofs`; hoặc
- URL HTTP/HTTPS.

Người nộp và ban tổ chức có quyền đọc minh chứng theo phạm vi. Ban tổ chức
duyệt khoản nộp với trạng thái:

- `pending`: đang chờ duyệt.
- `accepted`: đã chấp nhận.
- `rejected`: đã từ chối, có ghi chú.

Migration `20261105_fee_payment_integrity.sql` khóa chuyển trạng thái một chiều:
chỉ khoản `pending` mới được chuyển sang accepted/rejected; không mở lại khoản
đã xử lý bằng API trực tiếp.

## 10. Chứng nhận

### 10.1. Chứng nhận tham dự

Điều kiện cấp chứng nhận attendance:

1. Người dùng có đăng ký hội thảo.
2. Có điểm danh hội thảo thực tế.
3. Hội thảo đã kết thúc.
4. Không bị loại bởi trạng thái hủy hoặc điều kiện nghiệp vụ khác.

### 10.2. Chứng nhận báo cáo

Chứng nhận presentation gắn với từng bài accepted và người báo cáo. Người nhận
phải tham gia/điểm danh và phiên báo cáo liên quan phải kết thúc. Một tác giả
có nhiều bài được cấp chứng nhận riêng cho từng bài.

### 10.3. Xác nhận, phát hành và thu hồi

Chứng nhận có thể đi qua các trạng thái:

`pending_confirmation` → `submitted` → `issued`, hoặc `needs_changes`;
chứng nhận đã phát hành có thể chuyển `revoked` kèm lý do.

Hệ thống không tạo bản ghi trùng khi cấp lại cùng loại chứng nhận cho cùng người
và hội thảo/bài. QR chứa verification token để mở trang tra cứu công khai.
Trang tra cứu hiển thị trạng thái hiện tại, kể cả đã thu hồi.

PDF có thể được tạo tự động bởi `post-seminar`, lưu trong bucket private
`certificate-pdfs` và gửi kèm email. Ngoài ra có mẫu thủ công tại
`public/certificate-template.html` để điền và in thành PDF.

`signature_hash` hiện chỉ là mã đối chiếu MD5, **không phải chữ ký số**.
Muốn ký số thực sự cần chứng thư, khóa và dịch vụ ký phía server; không đặt
khóa ký trong frontend.

## 11. Thông báo, tin nhắn và email

### 11.1. Thông báo nội bộ

Thay đổi trạng thái bài, hoàn thành phản biện, lời mời reviewer và các sự kiện
nghiệp vụ tạo bản ghi `notifications`. Chuông đọc các thông báo đã lưu, cập
nhật khi mở và định kỳ khoảng 30 giây. Người dùng có thể bật/tắt nhóm thông báo
trong hồ sơ; toast chỉ là phản hồi tạm thời.

### 11.2. Tin nhắn

Người dùng trao đổi qua cuộc trò chuyện, thành viên cuộc trò chuyện và tin nhắn.
Quyền đọc/ghi được giới hạn theo thành viên và RLS.

### 11.3. Gmail

Admin có thể gửi:

- Chỉ thông báo nội bộ.
- Chỉ email Gmail.
- Cả nội bộ và Gmail.

Email được gửi riêng tới `profiles.contact_email` hợp lệ của nhóm nhận. Edge
Function `send-gmail-notification` kiểm tra JWT, bắt buộc người gọi là admin,
giới hạn độ dài nội dung và dùng Gmail OAuth scope `gmail.send`.

Các secret như client secret, refresh token và service role key chỉ lưu trong
Supabase Edge Function Secrets; không đưa vào `.env` frontend hoặc Git.

## 12. Báo cáo quản trị

Admin mở **Thống kê & Báo cáo**, chọn khoảng ngày, hội thảo và trạng thái rồi
nhấn làm mới. Các nhóm dữ liệu gồm:

- Số hội thảo, bài, đăng ký và chứng nhận.
- Phân bố người dùng/vai trò.
- Check-in, bài accepted/rejected/camera-ready.
- Số review đang chờ, quá hạn và thời gian phản biện trung bình.
- Chứng nhận còn thiếu.
- Hủy đăng ký và số liệu theo tháng.
- Bảng xếp hạng/tổng hợp theo hội thảo.

Khoảng ngày bao gồm cả hai đầu và theo múi giờ thiết bị. Bộ lọc không áp dụng
cho tổng người dùng hiện tại; các chỉ số còn lại áp dụng theo định nghĩa riêng
được mô tả trong [REPORTING.md](../supabase/REPORTING.md). CSV xuất có BOM
UTF-8, escape dấu nháy và vô hiệu hóa công thức từ dữ liệu văn bản.

## 13. Database, Storage và bảo mật dữ liệu

### 13.1. Các nhóm bảng chính

| Nhóm | Bảng tiêu biểu |
|---|---|
| Tài khoản | `profiles`, `profile_directory`, `organizer_requests` |
| Hội thảo | `conferences`, `conference_staff`, `conference_topics`, `conference_committees`, `conference_speakers`, `conference_announcements` |
| Bài và phản biện | `papers`, `paper_authors`, `paper_versions`, `paper_topics`, `reviews`, `reviewer_conflicts` |
| Đăng ký/điểm danh | `participants`, `attendance_sessions`, `reporting_events`, `session_attendance`, `session_checkin_codes` |
| Lịch/tài liệu/khảo sát | `sessions`, `conference_resources`, `session_feedback` |
| Kinh phí | `conference_funds`, `fee_payments` |
| Chứng nhận | `certificates` |
| Trao đổi | `conversations`, `conversation_members`, `messages`, `notifications` |
| Theo dõi/vận hành | `audit_logs`, `post_seminar_jobs`, `upload_cleanup_jobs` |

Tên cột và constraint chính nên được kiểm tra từ migration đang triển khai,
không tự suy đoán bằng dữ liệu frontend.

### 13.2. Bucket chính

- `conference-images`: ảnh bìa, có thể dùng URL public.
- `paper-files`: PDF bài báo; đặc biệt quan trọng với blind review.
- `conference-resources`: tài liệu phiên, private.
- `fee-proofs`: minh chứng kinh phí, private.
- `certificate-pdfs`: PDF chứng nhận tự động, private.

File bài báo đã tham chiếu không bị ghi đè. File upload bỏ dở chỉ được dọn ở
`conference-resources` và `fee-proofs` bởi worker, không dọn file bài báo hoặc
PDF chứng nhận.

### 13.3. RLS, RPC và audit

RLS giới hạn đọc/ghi theo user, vai trò, tư cách tác giả, reviewer và phạm vi
hội thảo. Các RPC quan trọng bao gồm đọc bài đã che danh tính, catalog bài,
quản lý hội thảo, kiểm tra quyền sửa bài, tạo phiên điểm danh, enqueue/claim
job sau hội thảo và reserve file bỏ dở.

`audit_logs` ghi các thao tác quản trị/nghiệp vụ quan trọng. Người dùng không
được tự sửa/xóa audit log. Thu hồi chứng nhận ghi sự kiện
`certificate.revoked` và lý do.

## 14. Tự động hóa phía server

### 14.1. `paper-download`

Nhận `paperId` và JWT, kiểm tra người gọi qua `read_papers`, sau đó đọc file
private bằng service role. Function không trả signed URL, không lộ object path
và chỉ cho phép file thuộc bucket `paper-files` của project.

### 14.2. `post-seminar`

Chạy sau hội thảo để:

- Tạo PDF chứng nhận attendance.
- Lưu PDF vào Storage.
- Gửi email chứng nhận.
- Gửi link khảo sát phiên.

Worker dùng job queue và marker `delivery_started_at` để tránh tự gửi trùng.
Job đã bắt đầu gửi mà gặp lỗi chuyển thành `uncertain`, không tự retry mù.
Chỉ job failed chưa bắt đầu delivery mới được retry có giới hạn.

### 14.3. `send-gmail-notification`

Gửi email theo yêu cầu admin, kiểm tra người nhận, lấy OAuth access token
và gọi Gmail API. Function không trả secrets hoặc nội dung lỗi nhạy cảm về
frontend.

### 14.4. `upload-cleanup`

Nhận job có `X-Job-Secret`, reserve tối đa 25 file bỏ dở mỗi lượt, xóa qua
Storage API rồi đánh dấu đã dọn. Có thể chạy theo lịch `pg_cron`/`pg_net`.

## 15. Cài đặt và triển khai

### 15.1. Chạy frontend local

```powershell
npm ci
```

Tạo `.env`:

```text
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<public-anon-key>
```

Khởi động:

```powershell
npm run dev -- --host 127.0.0.1 --port 5173
```

Frontend local vẫn kết nối Supabase theo `.env`; cài frontend không thay thế
database hoặc Edge Function.

### 15.2. Database mới và database đang dùng

Database mới:

1. `supabase/migrations/initialize_production.sql`
2. Các migration nền/bổ sung theo thứ tự trong [README.md](../README.md).

Database đang dùng:

- Không chạy lại initializer.
- Dùng `supabase/migrations/upgrade_existing_database.sql` sau khi backup; hoặc
  áp dụng các migration nguồn theo đúng thứ tự.
- Không chạy `conference_management_supabase.sql`, `conference_demo_data.sql`
  hoặc `create_*_accounts.sql` trên production vì có dữ liệu/tài khoản mẫu.

Các migration quan trọng gần đây:

- `20261008_complete_workflows.sql`
- `20261008_seminar_experience.sql`
- `20261009_certificate_consistency.sql`
- `20261010_email_delivery_safety.sql`
- `20261010_orphan_upload_cleanup.sql`
- `20261011_certificate_verification.sql`
- `20261011_review_revision.sql`
- `20261011_audit_integrity.sql`
- `20261104_certificate_confirmation_workflow.sql`
- `20261105_fee_payment_integrity.sql`
- `20261105_session_roles_and_types.sql`

Nếu có `DATABASE_URL`, có thể dùng script migration trong `scripts/`; không
ghi chuỗi kết nối vào chat, source hoặc frontend.

### 15.3. Deploy

1. Áp dụng migration và kiểm tra schema.
2. Deploy Edge Functions vào đúng Supabase project:

```powershell
npx supabase functions deploy paper-download
npx supabase functions deploy send-gmail-notification
npx supabase functions deploy post-seminar
npx supabase functions deploy upload-cleanup
```

3. Cấu hình secrets trong Supabase.
4. Build frontend và deploy thư mục `dist`.
5. Kiểm tra đăng nhập, RLS, tải PDF, QR camera, upload, email và chứng nhận
   trên môi trường staging/production trước nghiệm thu.

## 16. Kiểm thử và kiểm tra trước phát hành

Các lệnh chính:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run check
npm run verify:ui
npm run verify:schema
```

Ý nghĩa:

- `typecheck`: kiểm tra TypeScript.
- `lint`: kiểm tra quy tắc ESLint.
- `test`: chạy các test nghiệp vụ frontend/backend giả lập.
- `build`: kiểm tra bundle production.
- `check`: release check tổng hợp.
- `verify:ui`: kiểm tra UI headless, route, modal, PDF và nhiều vai trò.
- `verify:schema`: đọc kiểm tra bảng/cột backend thật.

Các test PGlite/local không ghi dữ liệu vào Supabase thật. Sau khi deploy cần
kiểm tra staging bằng từng vai trò, đặc biệt:

1. Nộp bài, retry, rollback và nộp phiên bản mới.
2. Blind review và tải PDF qua function.
3. Reviewer nhận/từ chối/gửi kết quả.
4. Hai người đăng ký chỗ cuối đồng thời.
5. Quét điểm danh lặp và cấp chứng nhận đồng thời.
6. Phân quyền staff giữa hai hội thảo.
7. Email Gmail và job `uncertain`.
8. Khôi phục backup ở database riêng.

Có thể chạy workflow API thật bằng `npm run verify:live-workflow` sau khi cấu
hình tài khoản thử. Dữ liệu thử có tiền tố `[TEST]`; không xóa tài khoản có
dữ liệu khác.

## 17. Sao lưu, theo dõi và xử lý sự cố

- Dùng `scripts/backup-database.ps1` để tạo archive PostgreSQL và checksum.
- Backup PostgreSQL không chứa bytes của Storage; phải sao lưu riêng từng bucket.
- Diễn tập restore vào database riêng, không restore trực tiếp production.
- Kiểm tra Supabase Auth, database, Storage và Edge Function logs khi có lỗi.
- Màn hình lỗi render có mã tham chiếu; không ghi token, mật khẩu hoặc nội dung
  form nhạy cảm vào console.
- QR tạo ở `localhost` chỉ có ý nghĩa khi người dùng truy cập được localhost
  đó; khi phát hành nên tạo lại QR bằng URL deploy.
- Thu hồi chứng nhận chặn các job email chưa bắt đầu; email đã bắt đầu có thể
  vẫn đến người nhận và cần đối chiếu log Gmail.

## 18. Giới hạn và việc chưa triển khai đầy đủ

1. `signature_hash` chưa phải chữ ký số.
2. Chưa có hệ thống nhận lỗi tập trung; cần theo dõi log Supabase/Edge Function.
3. Thống kê hiện tải nhiều dữ liệu về trình duyệt; dữ liệu rất lớn nên chuyển
   sang aggregate/search phân trang ở database.
4. URL bài báo bên ngoài không bảo đảm bất biến; PDF upload được khuyến nghị để
   lưu phiên bản chính xác.
5. Worker cleanup và post-seminar chỉ hoạt động đầy đủ sau khi deploy function,
   secrets và cron; frontend local không tự chạy các worker này.
6. Backup/restore Storage cần một quy trình riêng ngoài `pg_dump`.
7. Email nội bộ không tự trở thành email Gmail nếu admin chưa bật và cấu hình
   function gửi Gmail.

## 19. Bản đồ mã nguồn và tài liệu liên quan

| Khu vực | Nội dung |
|---|---|
| [src/App.tsx](../src/App.tsx) | Khởi tạo app, auth, route và phân trang chính |
| [src/pages/](../src/pages/) | Các màn hình nghiệp vụ |
| [src/components/](../src/components/) | Dashboard, lịch, báo cáo, tài liệu, thông báo và UI dùng chung |
| [src/context/](../src/context/) | Auth, router, quyền hội thảo và QR scanner |
| [src/lib/](../src/lib/) | Hằng số trạng thái, workflow bài, lịch, export, timeout và Supabase client |
| [supabase/migrations/](../supabase/migrations/) | Schema, RLS, trigger, RPC và nâng cấp database |
| [supabase/functions/](../supabase/functions/) | Các xử lý server-side |
| [supabase/tests/](../supabase/tests/) | Test SQL, workflow và integration giả lập |
| [docs/LOCAL_SETUP.md](LOCAL_SETUP.md) | Cài đặt/chạy local |
| [docs/OPERATIONS.md](OPERATIONS.md) | Vận hành, test live, backup và khôi phục |
| [supabase/AUTHOR_WORKFLOW.md](../supabase/AUTHOR_WORKFLOW.md) | Chi tiết luồng tác giả |
| [supabase/REVIEWER_WORKFLOW.md](../supabase/REVIEWER_WORKFLOW.md) | Chi tiết luồng reviewer |
| [supabase/POST_SEMINAR_AUTOMATION.md](../supabase/POST_SEMINAR_AUTOMATION.md) | Tự động hóa sau hội thảo |
| [supabase/GMAIL_NOTIFICATIONS.md](../supabase/GMAIL_NOTIFICATIONS.md) | Cấu hình Gmail OAuth |
| [supabase/REPORTING.md](../supabase/REPORTING.md) | Định nghĩa chỉ số và CSV |
| [supabase/UPLOAD_CLEANUP.md](../supabase/UPLOAD_CLEANUP.md) | Dọn file upload bỏ dở |

