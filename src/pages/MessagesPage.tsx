import { useCallback, useEffect, useState } from 'react';
import { BellRing, MessageCircle, Plus, Send, ShieldCheck, Search, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/useAuth';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { showToast } from '@/components/ui/toastStore';
import { ROLE_LABELS } from '@/lib/constants';
import type { UserRole } from '@/types';
import { useRouter } from '@/context/useRouter';

interface EmailReport { sent?: number; failed?: number; message?: string }

interface Conversation {
  id: string;
  subject: string;
  conversation_type: 'support' | 'broadcast';
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  sender?: { full_name: string; role: UserRole } | null;
}

export function MessagesPage() {
  const { profile } = useAuth();
  const { route, navigate } = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [targetRole, setTargetRole] = useState<'all' | UserRole>('all');
  const [delivery, setDelivery] = useState<'internal' | 'email' | 'both'>(route.params.compose === 'email' ? 'email' : 'internal');
  const [reply, setReply] = useState('');
  const [conversationSearch, setConversationSearch] = useState('');
  const isAdmin = profile?.role === 'admin';
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;
  const visibleConversations = conversations.filter((conversation) => conversation.subject.toLowerCase().includes(conversationSearch.toLowerCase().trim()));

  const loadConversations = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('conversations').select('*').order('updated_at', { ascending: false });
    if (error) showToast('error', 'Không thể tải hộp thư');
    else {
      const next = (data ?? []) as Conversation[];
      setConversations(next);
      setSelectedId((current) => current && next.some((item) => item.id === current) ? current : next[0]?.id ?? null);
    }
    setLoading(false);
  }, []);

  const loadMessages = useCallback(async () => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    const { data, error } = await supabase.from('messages').select('*, sender:profile_directory(full_name, role)').eq('conversation_id', selectedId).order('created_at', { ascending: true });
    if (error) showToast('error', 'Không thể tải nội dung hội thoại');
    else setMessages((data ?? []) as unknown as Message[]);
  }, [selectedId]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => {
    if (isAdmin && route.params.compose === 'email') {
      setDelivery('email');
      setComposerOpen(true);
      navigate('messages');
    }
  }, [isAdmin, navigate, route.params.compose]);
  useEffect(() => { void loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (!selectedId) return;
    const channel = supabase.channel(`messages-${selectedId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${selectedId}` }, () => {
        void loadMessages();
        void loadConversations();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [selectedId, loadMessages, loadConversations]);

  async function createConversation() {
    if (!subject.trim() || !body.trim()) {
      showToast('error', 'Vui lòng nhập tiêu đề và nội dung');
      return;
    }
    setSending(true);
    let data: unknown = null;
    let emailReport: EmailReport | null = null;
    if (isAdmin && (delivery === 'email' || delivery === 'both')) {
      const { data: response, error } = await supabase.functions.invoke('send-gmail-notification', {
        body: { subject: subject.trim(), message: body.trim(), targetRole: targetRole === 'all' ? null : targetRole },
      });
      if (error) {
        setSending(false);
        showToast('error', error.message || 'Không thể gửi email. Kiểm tra cấu hình Gmail trong Supabase.');
        return;
      }
      emailReport = response as EmailReport;
    }
    if (!isAdmin || delivery === 'internal' || delivery === 'both') {
      const result = isAdmin
        ? await supabase.rpc('send_admin_broadcast', { conversation_subject: subject.trim(), message_body: body.trim(), target_role: targetRole === 'all' ? null : targetRole })
        : await supabase.rpc('start_support_conversation', { conversation_subject: subject.trim(), initial_message: body.trim() });
      if (result.error) {
        setSending(false);
        showToast('error', delivery === 'both' ? `Email đã gửi nhưng thông báo nội bộ lỗi: ${result.error.message}` : result.error.message);
        return;
      }
      data = result.data;
    }
    setSending(false);
    setComposerOpen(false);
    setSubject('');
    setBody('');
    setTargetRole('all');
    await loadConversations();
    if (data) setSelectedId(data as string);
    const emailStatus = emailReport?.failed ? ` Gmail: ${emailReport.message ?? `đã gửi ${emailReport.sent}, lỗi ${emailReport.failed}.`}` : '';
    showToast(emailReport?.failed ? 'error' : 'success', !isAdmin ? 'Đã gửi yêu cầu hỗ trợ' : delivery === 'email' ? emailReport?.message ?? 'Đã gửi email thông báo qua Gmail' : delivery === 'both' ? `Đã gửi thông báo nội bộ.${emailStatus}` : 'Đã gửi thông báo nội bộ');
  }

  async function sendReply() {
    if (!profile || !selected || selected.conversation_type === 'broadcast' && !isAdmin) return;
    if (!reply.trim()) return;
    setSending(true);
    const { error } = await supabase.from('messages').insert({ conversation_id: selected.id, sender_id: profile.id, body: reply.trim() });
    setSending(false);
    if (error) {
      showToast('error', error.message);
      return;
    }
    setReply('');
    await Promise.all([loadMessages(), loadConversations()]);
  }

  return <div className="space-y-6">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h1 className="text-2xl font-bold text-slate-900">Tin nhắn</h1><p className="mt-1 text-sm text-slate-500">{isAdmin ? 'Trao đổi hỗ trợ và gửi thông báo nội bộ.' : 'Gửi yêu cầu hỗ trợ và nhận phản hồi từ quản trị viên.'}</p></div>
      <Button onClick={() => { setDelivery('internal'); setComposerOpen(true); }}><Plus className="h-4 w-4" />{isAdmin ? 'Gửi thông báo' : 'Yêu cầu hỗ trợ'}</Button>
    </div>

    <Card className="grid min-h-[34rem] overflow-hidden lg:grid-cols-[20rem_1fr]">
      <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-200 px-4 py-3"><p className="text-sm font-semibold text-slate-900">{isAdmin ? 'Tất cả hội thoại' : 'Hộp thư của bạn'}</p><div className="relative mt-2"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" /><input value={conversationSearch} onChange={(e) => setConversationSearch(e.target.value)} placeholder="Tìm hội thoại..." className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-2 text-sm" /></div></div>
        <div className="max-h-64 overflow-y-auto lg:max-h-[30.5rem]">{loading ? <Loading /> : visibleConversations.length === 0 ? <p className="px-4 py-8 text-center text-sm text-slate-400">Chưa có hội thoại</p> : visibleConversations.map((conversation) => <button key={conversation.id} type="button" onClick={() => setSelectedId(conversation.id)} className={`w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${conversation.id === selectedId ? 'bg-teal-50' : ''}`}><div className="flex items-center gap-2"><div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-xs font-semibold text-teal-700">{conversation.subject.slice(0, 1).toUpperCase()}</div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium text-slate-900">{conversation.subject}</p><Badge className={conversation.conversation_type === 'broadcast' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}>{conversation.conversation_type === 'broadcast' ? 'Thông báo' : 'Tin nhắn'}</Badge></div><p className="mt-1 text-xs text-slate-400">{formatDateTime(conversation.updated_at)}</p></div></div></button>)}</div>
      </aside>

      <section className="flex min-h-[28rem] flex-col">
        {!selected ? <div className="flex flex-1 flex-col items-center justify-center text-slate-400"><MessageCircle className="h-10 w-10" /><p className="mt-3 text-sm">Chọn một hội thoại để xem nội dung</p></div> : <>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3"><div><h2 className="font-semibold text-slate-900">{selected.subject}</h2><p className="mt-0.5 text-xs text-slate-500">{selected.conversation_type === 'broadcast' ? 'Thông báo nội bộ' : 'Hội thoại hỗ trợ'}</p></div>{selected.conversation_type === 'broadcast' && <BellRing className="h-5 w-5 text-sky-600" />}</div>
          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-5">{messages.map((message) => { const own = message.sender_id === profile?.id; return <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[80%] rounded-lg px-4 py-3 text-sm ${own ? 'bg-teal-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}><p className={`mb-1 text-xs font-medium ${own ? 'text-teal-50' : 'text-slate-500'}`}>{own ? 'Bạn' : message.sender?.full_name || 'Người dùng'}{message.sender?.role && !own ? ` · ${ROLE_LABELS[message.sender.role]}` : ''}</p><p className="whitespace-pre-wrap leading-6">{message.body}</p><p className={`mt-1 text-right text-[11px] ${own ? 'text-teal-100' : 'text-slate-400'}`}>{formatDateTime(message.created_at)}</p></div></div>; })}</div>
          {selected.conversation_type === 'broadcast' && !isAdmin ? <p className="border-t border-slate-200 px-5 py-4 text-center text-sm text-slate-500">Đây là thông báo từ quản trị viên.</p> : <div className="flex gap-3 border-t border-slate-200 p-4"><textarea value={reply} onChange={(event) => setReply(event.target.value)} rows={2} placeholder="Nhập phản hồi..." className="min-h-12 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20" /><Button onClick={() => void sendReply()} disabled={sending || !reply.trim()} title="Gửi phản hồi" aria-label="Gửi phản hồi"><Send className="h-4 w-4" /></Button></div>}
        </>}
      </section>
    </Card>

    <Modal open={composerOpen} onClose={() => setComposerOpen(false)} title={isAdmin ? delivery === 'email' ? 'Gửi thông báo qua Gmail' : delivery === 'both' ? 'Gửi thông báo nội bộ và Gmail' : 'Gửi thông báo nội bộ' : 'Gửi yêu cầu hỗ trợ'} size="md">
      <div className="space-y-4">
        {isAdmin && <label className="block text-sm font-medium text-slate-700">Kênh gửi<select value={delivery} onChange={(event) => setDelivery(event.target.value as 'internal' | 'email' | 'both')} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="internal">Thông báo nội bộ</option><option value="email">Email qua Gmail</option><option value="both">Cả nội bộ và Gmail</option></select></label>}
        {isAdmin && <label className="block text-sm font-medium text-slate-700">Người nhận<select value={targetRole} onChange={(event) => setTargetRole(event.target.value as 'all' | UserRole)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm"><option value="all">Tất cả tài khoản</option>{(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></label>}
        <label className="block text-sm font-medium text-slate-700">Tiêu đề<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20" /></label>
        <label className="block text-sm font-medium text-slate-700">Nội dung<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} maxLength={4000} className="mt-1.5 w-full resize-y rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20" /></label>
        {isAdmin && (delivery === 'email' || delivery === 'both') && <p className="text-xs text-slate-500">Email được gửi đến địa chỉ liên hệ đã lưu trong hồ sơ tài khoản. Nếu thiếu email, người nhận đó sẽ bị bỏ qua.</p>}
        <div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setComposerOpen(false)}>Hủy</Button><Button onClick={() => void createConversation()} disabled={sending}>{isAdmin && delivery !== 'internal' ? <Mail className="h-4 w-4" /> : isAdmin ? <ShieldCheck className="h-4 w-4" /> : <Send className="h-4 w-4" />}{sending ? 'Đang gửi...' : 'Gửi'}</Button></div>
      </div>
    </Modal>
  </div>;
}

function Loading() { return <div className="flex justify-center py-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" /></div>; }
function formatDateTime(value: string) { return new Date(value).toLocaleString('vi-VN'); }
