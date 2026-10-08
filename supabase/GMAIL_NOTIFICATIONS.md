# Hướng dẫn bật gửi thông báo qua Gmail

Trang quản trị có nút **Thông báo Gmail**. Admin có thể gửi qua Gmail, gửi nội bộ trong ứng dụng hoặc chọn cả hai. Email được gửi riêng đến `profiles.contact_email` của từng tài khoản trong nhóm đã chọn. Tài khoản không có email hợp lệ sẽ được bỏ qua.

Luồng gửi cần ba phần: bật Gmail API và OAuth ở Google, lưu thông tin bí mật vào Supabase, rồi deploy Edge Function của dự án. Gmail API dùng quyền gửi thư `gmail.send`; mật khẩu Gmail thông thường không được dùng.

## 1. Tạo OAuth credentials tại Google

1. Mở [Google Cloud Console](https://console.cloud.google.com/) và đăng nhập bằng tài khoản Gmail sẽ đứng tên gửi thông báo.
2. Tạo project mới hoặc chọn project đang dùng.
3. Vào **APIs & Services → Library**, tìm **Gmail API**, mở trang API và bấm **Enable**.
4. Vào **Google Auth Platform** (hoặc **APIs & Services → OAuth consent screen**) và cấu hình màn hình đồng ý OAuth:
   - Chọn loại người dùng phù hợp. Nếu đang thử nghiệm bằng Gmail cá nhân, chọn **External**.
   - Nhập tên ứng dụng và email hỗ trợ.
   - Nếu ứng dụng ở chế độ **Testing**, thêm chính tài khoản Gmail gửi thư vào **Test users**.
5. Mở **Clients → Create client** (hoặc **Credentials → Create credentials → OAuth client ID**), chọn **Web application**.
6. Trong **Authorized redirect URIs**, thêm chính xác:

   ```text
   https://developers.google.com/oauthplayground
   ```

7. Tạo client và lưu lại **Client ID** cùng **Client secret**. Không đưa hai giá trị này vào mã frontend, file `.env` của Vite hay Git.

## 2. Lấy refresh token có quyền gửi Gmail

Refresh token là mã dài hạn để Edge Function xin access token mới khi cần. Tạo token bằng OAuth Playground:

1. Mở [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Bấm biểu tượng bánh răng ở góc trên bên phải.
3. Bật **Use your own OAuth credentials**, điền Client ID và Client secret vừa tạo.
4. Bật **Access type: Offline** để yêu cầu refresh token.
5. Ở bước chọn API, nhập hoặc chọn scope sau:

   ```text
   https://www.googleapis.com/auth/gmail.send
   ```

   Đây là scope gửi email của [Gmail API](https://developers.google.com/gmail/api/auth/scopes).
6. Bấm **Authorize APIs** và đăng nhập đúng tài khoản Gmail gửi thư. Chấp thuận quyền gửi email.
7. Ở bước 2, bấm **Exchange authorization code for tokens**.
8. Sao chép giá trị **refresh_token** trong phản hồi và cất ở nơi an toàn. Không chia sẻ hoặc dán token vào chat. Nếu Playground không trả refresh token, hãy thu hồi quyền ứng dụng trong tài khoản Google rồi cấp quyền lại; bảo đảm đã chọn **Offline**.

> **Lưu ý khi thử nghiệm:** nếu màn hình OAuth đang ở trạng thái **Testing** và loại người dùng là **External**, Google sẽ làm refresh token hết hạn sau 7 ngày với scope Gmail này. Khi đó phải cấp lại token. Để chạy lâu dài, cần chuyển app sang **In production**; Google có thể yêu cầu xác minh OAuth cho ứng dụng và scope được yêu cầu. Xem [quy định thời hạn refresh token của Google](https://developers.google.com/identity/protocols/oauth2#expiration).

## 3. Liên kết máy với đúng dự án Supabase

Mở PowerShell tại thư mục gốc dự án (thư mục có `package.json`) và chạy:

```powershell
npx supabase --version
npx supabase login
npx supabase projects list
npx supabase link --project-ref YOUR_PROJECT_REF
```

Thay `YOUR_PROJECT_REF` bằng **Reference ID** của đúng Supabase project. Có thể xem ở **Supabase Dashboard → Project Settings → General**. Nếu CLI hỏi database password, nhập database password của project đó; đây không phải mật khẩu Gmail.

## 4. Lưu secrets trong Supabase

Tại PowerShell, chạy lệnh sau và thay phần bên phải dấu `=` bằng credentials thật:

```powershell
npx supabase secrets set 'GMAIL_CLIENT_ID=YOUR_CLIENT_ID' 'GMAIL_CLIENT_SECRET=YOUR_CLIENT_SECRET' 'GMAIL_REFRESH_TOKEN=YOUR_REFRESH_TOKEN' 'GMAIL_SENDER=your-sender@gmail.com'
```

`GMAIL_SENDER` phải là địa chỉ Gmail đã cấp OAuth và phải nhập đúng địa chỉ email, không kèm tên hiển thị. Secrets được giữ trong Supabase; không ghi giá trị thật vào file dự án. Supabase cũng cho phép nhập các key/value này ở **Dashboard → Edge Functions → Secrets**. Tài liệu: [Supabase Function Secrets](https://supabase.com/docs/guides/functions/secrets).

## 5. Đảm bảo hồ sơ có email rồi deploy

Nếu database chưa có cột `profiles.contact_email`, mở **Supabase Dashboard → SQL Editor**, chạy toàn bộ file `supabase/migrations/conference_updates.sql`. Migration này thêm cột và điền email hiện có từ Supabase Auth khi có thể. Sau đó vào PowerShell ở thư mục gốc dự án và deploy:

```powershell
npx supabase functions deploy send-gmail-notification
```

Sau khi deploy thành công, Supabase sẽ cung cấp function `send-gmail-notification`. Việc cập nhật secrets sau đó không cần deploy lại. Hướng dẫn CLI chính thức: [Deploy Edge Functions](https://supabase.com/docs/guides/functions/quickstart).

## 6. Gửi email thử

1. Đăng nhập ứng dụng bằng tài khoản admin.
2. Mở trang **Tổng quan** và bấm **Thông báo Gmail**.
3. Soạn tiêu đề và nội dung. Ở lần đầu, chọn nhóm nhận hẹp nhất có thể (ví dụ **Admin**) vì thao tác sẽ gửi thật đến toàn bộ tài khoản trong nhóm đó có email.
4. Chọn **Email qua Gmail** rồi bấm **Gửi**.
5. Ứng dụng sẽ báo số email gửi thành công và số email lỗi. Kiểm tra cả hộp thư đến và Spam.

Muốn gửi đồng thời trên ứng dụng và email, chọn **Cả nội bộ và Gmail**. Nếu Gmail gửi xong nhưng tạo thông báo nội bộ thất bại, giao diện sẽ báo rõ email đã được gửi.

## Lỗi thường gặp

- **Chưa cấu hình Gmail API...**: thiếu một trong bốn secrets `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`.
- **Gmail không cấp được quyền gửi email**: kiểm tra client ID/secret, refresh token, tài khoản Google đã cấp quyền, Gmail API đã bật và scope `gmail.send` đã được chấp thuận.
- **Không có người nhận nào có email...**: kiểm tra migration contact email đã chạy chưa và địa chỉ liên hệ có được lưu trong `profiles.contact_email` không.
- **Chỉ admin được gửi...**: đăng nhập bằng tài khoản có `profiles.role = 'admin'`.
- **Deploy báo chưa liên kết project**: chạy `npx supabase link --project-ref YOUR_PROJECT_REF` trong thư mục dự án.

Không chia sẻ Client secret hoặc refresh token. Nếu token bị lộ, thu hồi quyền ứng dụng trong Google Account và tạo lại credentials/token.
