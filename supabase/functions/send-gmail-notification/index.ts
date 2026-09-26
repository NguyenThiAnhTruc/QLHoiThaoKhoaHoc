const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Bạn cần đăng nhập.' });

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const clientId = Deno.env.get('GMAIL_CLIENT_ID');
  const clientSecret = Deno.env.get('GMAIL_CLIENT_SECRET');
  const refreshToken = Deno.env.get('GMAIL_REFRESH_TOKEN');
  const sender = Deno.env.get('GMAIL_SENDER');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !clientId || !clientSecret || !refreshToken || !sender) {
    return json(503, { error: 'Chưa cấu hình Gmail API trong Supabase Edge Function Secrets.' });
  }

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization },
    });
    if (!userResponse.ok) return json(401, { error: 'Phiên đăng nhập không hợp lệ.' });
    const user = await userResponse.json();

    const adminHeaders = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` };
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`, {
      headers: adminHeaders,
    });
    const callerProfiles = await profileResponse.json();
    if (!profileResponse.ok || callerProfiles?.[0]?.role !== 'admin') return json(403, { error: 'Chỉ admin được gửi email thông báo.' });

    const input = await request.json();
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const message = typeof input.message === 'string' ? input.message.trim() : '';
    const targetRole = input.targetRole ?? null;
    if (!subject || subject.length > 160 || !message || message.length > 4000) {
      return json(400, { error: 'Tiêu đề và nội dung bắt buộc; tiêu đề tối đa 160, nội dung tối đa 4000 ký tự.' });
    }
    if (targetRole !== null && !['admin', 'organizer', 'author', 'participant'].includes(targetRole)) {
      return json(400, { error: 'Nhóm người nhận không hợp lệ.' });
    }

    const roleFilter = targetRole ? `&role=eq.${encodeURIComponent(targetRole)}` : '';
    const recipientsResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?select=contact_email${roleFilter}&contact_email=neq.&order=id&limit=500`, {
      headers: adminHeaders,
    });
    const recipientRows = await recipientsResponse.json();
    if (!recipientsResponse.ok) return json(502, { error: 'Không lấy được danh sách email người nhận.' });
    const recipients = [...new Set((recipientRows as { contact_email?: string }[])
      .map((row) => row.contact_email?.trim())
      .filter((email): email is string => Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))))];
    if (!recipients.length) return json(400, { error: 'Không có người nhận nào có email liên hệ hợp lệ.' });

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) return json(502, { error: 'Gmail không cấp được quyền gửi email. Kiểm tra OAuth credentials.' });

    const safeSender = sender.trim();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(safeSender)) return json(503, { error: 'GMAIL_SENDER phải là địa chỉ Gmail hợp lệ.' });
    const encodedSubject = `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(subject)))}?=`;
    let sent = 0;
    const failed: string[] = [];
    for (const recipient of recipients) {
      const mime = [
        `From: ${safeSender}`,
        `To: ${recipient}`,
        `Subject: ${encodedSubject}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        btoa(String.fromCharCode(...new TextEncoder().encode(message))),
      ].join('\r\n');
      const gmailResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: base64Url(new TextEncoder().encode(mime)) }),
      });
      if (gmailResponse.ok) sent += 1;
      else failed.push(recipient);
    }

    if (sent === 0) return json(502, { error: 'Gmail không gửi được email nào. Kiểm tra quyền Gmail API và địa chỉ người gửi.', sent, failed: failed.length });
    return json(200, { sent, failed: failed.length, message: failed.length ? `Đã gửi ${sent}/${recipients.length} email; ${failed.length} email lỗi.` : `Đã gửi ${sent} email.` });
  } catch (error) {
    console.error('send-gmail-notification failed', error);
    return json(500, { error: 'Có lỗi khi gửi email thông báo.' });
  }
});
