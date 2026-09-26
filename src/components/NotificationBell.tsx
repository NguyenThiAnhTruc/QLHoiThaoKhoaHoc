import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/useAuth';

interface NotificationItem {
  id: string;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

export function NotificationBell() {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const userId = profile?.id;

  const loadNotifications = useCallback(async () => {
    const currentRequest = ++requestId.current;
    if (!userId) { setNotifications([]); setUnreadCount(0); return; }
    setLoading(true);
    const [itemsResult, unreadResult] = await Promise.all([
      supabase.from('notifications').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(8),
      supabase.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', userId).is('read_at', null),
    ]);
    if (currentRequest !== requestId.current) return;
    if (itemsResult.error || unreadResult.error) {
      setError('Không thể tải thông báo. Vui lòng thử lại.');
    } else {
      setError('');
      setNotifications((itemsResult.data ?? []) as NotificationItem[]);
      setUnreadCount(unreadResult.count ?? 0);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    const requests = requestId;
    setNotifications([]);
    setUnreadCount(0);
    void loadNotifications();
    const interval = window.setInterval(() => { void loadNotifications(); }, 30000);
    return () => { window.clearInterval(interval); requests.current++; };
  }, [loadNotifications]);

  async function toggle() {
    setOpen((current) => !current);
    if (!open) await loadNotifications();
  }

  async function markAllRead() {
    if (!profile || unreadCount === 0) return;
    const { error: updateError } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', profile.id).is('read_at', null);
    if (updateError) { setError('Không thể đánh dấu đã đọc. Vui lòng thử lại.'); return; }
    await loadNotifications();
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => void toggle()} aria-label="Thông báo" aria-expanded={open} title="Thông báo" className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500/30">
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div><h2 className="text-sm font-semibold text-slate-900">Thông báo</h2><p className="mt-0.5 text-xs text-slate-500">{error ? 'Không tải được dữ liệu' : unreadCount > 0 ? `${unreadCount} chưa đọc` : 'Bạn đã xem hết thông báo'}</p></div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void markAllRead()} disabled={unreadCount === 0} title="Đánh dấu tất cả đã đọc" aria-label="Đánh dấu tất cả đã đọc" className="rounded-md p-1.5 text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-40"><CheckCheck className="h-4 w-4" /></button>
              <button type="button" onClick={() => setOpen(false)} title="Đóng thông báo" aria-label="Đóng thông báo" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {error && <div role="alert" className="px-4 py-3 text-sm text-rose-700">{error} <button type="button" className="underline" onClick={() => void loadNotifications()}>Thử lại</button></div>}
            {loading ? <div className="flex justify-center py-8"><div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" /></div> : notifications.length === 0 ? !error && <p className="px-4 py-8 text-center text-sm text-slate-400">Chưa có thông báo nào</p> : notifications.map((notification) => (
              <div key={notification.id} className={`border-b border-slate-100 px-4 py-3 last:border-0 ${notification.read_at ? 'bg-white' : 'bg-teal-50/60'}`}>
                <p className="text-sm font-medium text-slate-900">{notification.title}</p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{notification.message}</p>
                <p className="mt-1 text-xs text-slate-400">{new Date(notification.created_at).toLocaleString('vi-VN')}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
