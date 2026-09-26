import { OrganizerRequests } from '@/components/OrganizerRequests';
import { useRef, useState } from 'react';
import { Bell, Globe2, ImagePlus, KeyRound, LoaderCircle, Mail, Save, Settings2, ShieldCheck, UserRound } from 'lucide-react';
import { useAuth } from '@/context/useAuth';
import { supabase } from '@/lib/supabase';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input, Select, Textarea } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { showToast } from '@/components/ui/toastStore';
import { ROLE_LABELS } from '@/lib/constants';

type Tab = 'profile' | 'notifications' | 'security' | 'preferences';
type NotificationPreferences = Record<'system' | 'messages' | 'reviews' | 'certificates', boolean>;
const defaultPreferences: NotificationPreferences = { system: true, messages: true, reviews: true, certificates: true };

export function ProfilePage() {
  const { profile, session, refreshProfile } = useAuth();
  const [tab, setTab] = useState<Tab>('profile');
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [organization, setOrganization] = useState(profile?.organization ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? '');
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferences>({ ...defaultPreferences, ...(profile?.notification_preferences ?? {}) });
  const [language, setLanguage] = useState(profile?.language ?? 'vi');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'Asia/Ho_Chi_Minh');
  const [saving, setSaving] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const profileId = profile?.id;
  const avatarInputRef = useRef<HTMLInputElement>(null);

  if (!profile) return null;

  async function save(values: Record<string, unknown>, successMessage: string) {
    if (!profileId) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update(values).eq('id', profileId);
    setSaving(false);
    if (error) showToast('error', 'Không thể lưu cài đặt');
    else {
      await refreshProfile();
      showToast('success', successMessage);
    }
  }

  async function saveProfile() {
    if (!fullName.trim()) {
      showToast('error', 'Vui lòng nhập họ và tên');
      return;
    }
    await save({ full_name: fullName.trim(), phone: phone.trim(), organization: organization.trim(), bio: bio.trim(), avatar_url: avatarUrl.trim() }, 'Đã cập nhật hồ sơ');
  }

  async function uploadAvatar(file?: File) {
    if (!file || !profileId) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'Vui lòng chọn tệp ảnh');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('error', 'Ảnh đại diện không được vượt quá 2 MB');
      return;
    }
    const extension = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${profileId}/avatar-${Date.now()}.${extension}`;
    setUploadingAvatar(true);
    const { error: uploadError } = await supabase.storage.from('profile-avatars').upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    setUploadingAvatar(false);
    if (uploadError) {
      showToast('error', 'Không thể tải ảnh đại diện lên');
      return;
    }
    const { data } = supabase.storage.from('profile-avatars').getPublicUrl(path);
    setAvatarUrl(data.publicUrl);
    setAvatarFailed(false);
    await save({ avatar_url: data.publicUrl }, 'Đã cập nhật ảnh đại diện');
  }

  async function changePassword() {
    if (newPassword.length < 6) {
      showToast('error', 'Mật khẩu mới phải có ít nhất 6 ký tự');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('error', 'Mật khẩu xác nhận không khớp');
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) return showToast('error', error.message);
    setNewPassword('');
    setConfirmPassword('');
    setPasswordModalOpen(false);
    showToast('success', 'Đã cập nhật mật khẩu');
  }

  const displayName = fullName.trim() || profile.full_name || 'Chưa đặt tên';
  const tabs: { key: Tab; label: string; icon: typeof UserRound }[] = [
    { key: 'profile', label: 'Hồ sơ', icon: UserRound },
    { key: 'notifications', label: 'Thông báo', icon: Bell },
    { key: 'security', label: 'Bảo mật', icon: ShieldCheck },
    { key: 'preferences', label: 'Tùy chọn', icon: Settings2 },
  ];

  return <div className="mx-auto max-w-5xl space-y-6">
    <div><h1 className="text-2xl font-bold text-slate-900">Hồ sơ & cài đặt</h1><p className="mt-1 text-sm text-slate-500">Quản lý thông tin, bảo mật và tùy chọn tài khoản của bạn.</p></div>
    {profile.role !== 'admin' && <OrganizerRequests />}
    <Card className="overflow-hidden">
      <div className="bg-gradient-to-r from-teal-600 to-teal-500 px-6 py-6 text-white sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white/40 bg-white/20 text-xl font-bold">{avatarUrl.trim() && !avatarFailed ? <img src={avatarUrl.trim()} alt={displayName} className="h-full w-full object-cover" onError={() => setAvatarFailed(true)} /> : displayName.charAt(0).toUpperCase()}</div><div className="min-w-0"><h2 className="truncate text-xl font-bold">{displayName}</h2><p className="mt-1 flex items-center gap-1.5 text-sm text-teal-50"><Mail className="h-4 w-4" />{session?.user.email || 'Chưa có email'}</p><Badge className="mt-3 bg-white/20 text-white">{ROLE_LABELS[profile.role]}</Badge></div></div><input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { void uploadAvatar(event.target.files?.[0]); event.currentTarget.value = ''; }} /><Button type="button" variant="outline" className="border-white/40 bg-white/10 text-white hover:bg-white/20 hover:text-white" onClick={() => avatarInputRef.current?.click()} disabled={uploadingAvatar}>{uploadingAvatar ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}{uploadingAvatar ? 'Đang tải...' : 'Tải ảnh lên'}</Button></div>
      </div>
      <div className="flex overflow-x-auto border-b border-slate-200 px-3">{tabs.map((item) => { const Icon = item.icon; return <button key={item.key} type="button" onClick={() => setTab(item.key)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${tab === item.key ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</div>
      <div className="p-6 sm:p-8">
        {tab === 'profile' && <div className="space-y-5"><SectionTitle title="Thông tin cá nhân" description="Thông tin này sẽ hiển thị trong các hoạt động hội thảo của bạn." /><div className="grid gap-4 sm:grid-cols-2"><Input label="Họ và tên" value={fullName} onChange={(event) => setFullName(event.target.value)} required /><Input label="Số điện thoại" value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" /></div><Input label="Tổ chức / Đơn vị" value={organization} onChange={(event) => setOrganization(event.target.value)} /><Input label="URL ảnh đại diện" type="url" value={avatarUrl} placeholder="https://..." onChange={(event) => { setAvatarUrl(event.target.value); setAvatarFailed(false); }} /><Textarea label="Giới thiệu" value={bio} onChange={(event) => setBio(event.target.value)} maxLength={500} /><div className="flex items-center justify-between border-t border-slate-100 pt-5"><p className="text-xs text-slate-500">Vai trò được quản trị viên quản lý.</p><Button onClick={() => void saveProfile()} disabled={saving}><Save className="h-4 w-4" />{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</Button></div></div>}
        {tab === 'notifications' && <div className="space-y-5"><SectionTitle title="Thông báo trong hệ thống" description="Chọn các loại thông báo muốn nhận trong ứng dụng." /><div className="divide-y divide-slate-100 rounded-lg border border-slate-200">{([{ key: 'system', title: 'Thông báo hệ thống', description: 'Cập nhật chung và thay đổi quan trọng.' }, { key: 'messages', title: 'Tin nhắn mới', description: 'Phản hồi hỗ trợ và thông báo từ quản trị viên.' }, { key: 'reviews', title: 'Phản biện', description: 'Phân công, kết quả và deadline phản biện.' }, { key: 'certificates', title: 'Chứng nhận', description: 'Thông báo về việc cấp chứng nhận.' }] as const).map((item) => <label key={item.key} className="flex cursor-pointer items-center justify-between gap-5 px-4 py-4"><span><span className="block text-sm font-medium text-slate-900">{item.title}</span><span className="mt-1 block text-xs text-slate-500">{item.description}</span></span><span className="relative inline-flex shrink-0"><input type="checkbox" checked={preferences[item.key]} onChange={(event) => setPreferences((current) => ({ ...current, [item.key]: event.target.checked }))} className="peer sr-only" /><span className="h-5 w-9 rounded-full bg-slate-300 transition-colors peer-checked:bg-teal-600 peer-focus:ring-2 peer-focus:ring-teal-500/30" /><span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" /></span></label>)}</div><div className="flex justify-end"><Button onClick={() => void save({ notification_preferences: preferences }, 'Đã lưu tùy chọn thông báo')} disabled={saving}><Save className="h-4 w-4" />Lưu tùy chọn</Button></div></div>}
        {tab === 'security' && <div className="space-y-5"><SectionTitle title="Bảo mật tài khoản" description="Giữ thông tin đăng nhập của bạn an toàn." /><div className="rounded-lg border border-slate-200 p-4"><p className="text-sm text-slate-500">Email đăng nhập</p><p className="mt-1 break-all font-medium text-slate-900">{session?.user.email || 'Chưa cập nhật'}</p></div><div className="rounded-lg border border-slate-200 p-4"><div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium text-slate-900">Mật khẩu</p><p className="mt-1 text-sm text-slate-500">Đặt mật khẩu mới tối thiểu 6 ký tự.</p></div><Button variant="outline" onClick={() => setPasswordModalOpen(true)}><KeyRound className="h-4 w-4" />Đổi mật khẩu</Button></div></div></div>}
        {tab === 'preferences' && <div className="space-y-5"><SectionTitle title="Tùy chọn hiển thị" description="Thiết lập ngôn ngữ và múi giờ sử dụng trong hệ thống." /><div className="grid gap-4 sm:grid-cols-2"><Select label="Ngôn ngữ" value={language} onChange={(event) => setLanguage(event.target.value as 'vi' | 'en')}><option value="vi">Tiếng Việt</option><option value="en">English</option></Select><Select label="Múi giờ" value={timezone} onChange={(event) => setTimezone(event.target.value)}><option value="Asia/Ho_Chi_Minh">Việt Nam (GMT+7)</option><option value="UTC">UTC (GMT+0)</option></Select></div><div className="rounded-lg bg-teal-50 p-4 text-sm text-teal-800"><Globe2 className="mr-2 inline h-4 w-4" />Các mốc thời gian mới sẽ ưu tiên hiển thị theo múi giờ bạn chọn.</div><div className="flex justify-end"><Button onClick={() => void save({ language, timezone }, 'Đã lưu tùy chọn hiển thị')} disabled={saving}><Save className="h-4 w-4" />Lưu tùy chọn</Button></div></div>}
      </div>
    </Card>

    <Modal open={passwordModalOpen} onClose={() => setPasswordModalOpen(false)} title="Đổi mật khẩu" size="sm"><div className="space-y-4"><p className="text-sm text-slate-500">Mật khẩu mới cần có ít nhất 6 ký tự.</p><Input label="Mật khẩu mới" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><Input label="Xác nhận mật khẩu mới" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /><div className="flex justify-end gap-3 pt-2"><Button variant="outline" onClick={() => setPasswordModalOpen(false)}>Hủy</Button><Button onClick={() => void changePassword()} disabled={changingPassword}>{changingPassword ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}</Button></div></div></Modal>
  </div>;
}

function SectionTitle({ title, description }: { title: string; description: string }) { return <div><h2 className="font-semibold text-slate-900">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div>; }
