import { OrganizerRequests } from '@/components/OrganizerRequests';
import { fetchAll } from '@/lib/fetchAll';
import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, ShieldCheck, Users } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { showToast } from "@/components/ui/toastStore";
import { ALL_ROLES, ROLE_LABELS } from "@/lib/constants";
import type { Profile, UserRole } from "@/types";

const PAGE_SIZE = 10;

interface PendingRoleChange {
  user: Profile;
  role: UserRole;
}

export function UsersPage() {
  const { profile } = useAuth();
  const { navigate } = useRouter();
  const [users, setUsers] = useState<Profile[]>([]);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<UserRole | "all">("all");
  const [page, setPage] = useState(1);
  const [conferenceFilter, setConferenceFilter] = useState("");
  const [participationFilter, setParticipationFilter] = useState("all");
  const [conferences, setConferences] = useState<{id: string; title: string}[]>([]);
  const [memberships, setMemberships] = useState<{user_id: string; conference_id: string; participation_status: string}[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pendingChange, setPendingChange] = useState<PendingRoleChange | null>(null);

  useEffect(() => {
    if (profile && profile.role !== "admin") navigate("dashboard");
  }, [navigate, profile]);

  useEffect(() => {
    if (profile?.role === "admin") loadUsers();
  }, [profile?.role]);

  async function loadUsers() {
    setLoading(true);
    const { data, error } = await fetchAll((from, to) => supabase.from("profiles").select("*", { count: "exact" }).order("full_name").order("id").range(from, to));
    if (error) showToast("error", "Không thể tải danh sách tài khoản");
    else setUsers((data ?? []) as Profile[]);
    const [conferenceResult, authorResult, paperResult] = await Promise.all([
      fetchAll((from,to) => supabase.from("conferences").select("id,title", {count:"exact"}).order("id").range(from,to)),
      fetchAll((from,to) => supabase.from("paper_authors").select("user_id,participation_status,paper:papers(conference_id)", {count:"exact"}).order("id").range(from,to)),
      fetchAll((from,to) => supabase.from("papers").select("submitted_by,conference_id,author_participation_status", {count:"exact"}).order("id").range(from,to)),
    ]);
    if (conferenceResult.error || authorResult.error || paperResult.error) showToast("error", "Không thể tải trạng thái tham gia của tác giả");
    setConferences((conferenceResult.data ?? []) as {id:string;title:string}[]);
    const authorRows = (authorResult.data ?? []) as unknown as {user_id:string; participation_status:string; paper:{conference_id:string}|null}[];
    const owners = (paperResult.data ?? []) as {submitted_by:string|null;conference_id:string;author_participation_status:string}[];
    setMemberships([
      ...authorRows.filter((row) => row.paper).map((row) => ({user_id:row.user_id,conference_id:row.paper!.conference_id,participation_status:row.participation_status})),
      ...owners.filter((row) => row.submitted_by).map((row) => ({user_id:row.submitted_by!,conference_id:row.conference_id,participation_status:row.author_participation_status})),
    ]);
    setLoading(false);
  }

  function requestRoleChange(user: Profile, role: UserRole) {
    if (user.role === role) return;
    if (user.id === profile?.id) {
      showToast("error", "Bạn không thể thay đổi role của chính mình");
      return;
    }
    setPendingChange({ user, role });
  }

  async function confirmRoleChange() {
    if (!pendingChange || updatingId) return;
    const { user, role } = pendingChange;
    setUpdatingId(user.id);
    const { error } = await supabase.from("profiles").update({ role }).eq("id", user.id).eq("role", user.role).select("id").single();
    setUpdatingId(null);

    if (error) {
      showToast("error", `Cập nhật vai trò thất bại: ${error.message}`);
      return;
    }

    setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, role } : item)));
    setPendingChange(null);
    showToast("success", "Đã cập nhật vai trò và ghi lịch sử quản trị");
  }

  const filteredUsers = useMemo(() => {
    const query = search.toLowerCase().trim();
    return users.filter((user) => (!query || user.full_name.toLowerCase().includes(query) || user.organization.toLowerCase().includes(query)) && (roleFilter === "all" || user.role === roleFilter)
      && ((!conferenceFilter && participationFilter === "all") || memberships.some((member) => member.user_id === user.id
        && (!conferenceFilter || member.conference_id === conferenceFilter)
        && (participationFilter === "all" || member.participation_status === participationFilter))));
  }, [roleFilter, search, users, conferenceFilter, participationFilter, memberships]);
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  if (!profile || profile.role !== "admin") return <div className="py-20 text-center text-sm text-slate-500">Đang chuyển về trang tổng quan...</div>;

  return <div className="space-y-6"><div><h1 className="text-2xl font-bold text-slate-900">Tài khoản</h1><p className="mt-1 text-sm text-slate-500">Quản lý người dùng và vai trò trong hệ thống</p></div><OrganizerRequests admin onReviewed={() => void loadUsers()} />
    <div className="flex flex-wrap gap-3">
      <select aria-label="Lọc tác giả theo hội thảo" value={conferenceFilter} onChange={(event) => { setConferenceFilter(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white p-2"><option value="">Tất cả hội thảo</option>{conferences.map((conference) => <option key={conference.id} value={conference.id}>{conference.title}</option>)}</select>
      <select aria-label="Trạng thái tham gia bài báo" value={participationFilter} onChange={(event) => { setParticipationFilter(event.target.value); setPage(1); }} className="rounded-lg border border-slate-300 bg-white p-2"><option value="all">Tất cả trạng thái tham gia</option><option value="participating">Tham gia bài báo</option><option value="not_participating">Không tham gia bài báo</option></select>
    </div><div className="flex flex-col gap-3 sm:flex-row"><div className="relative max-w-xl flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input type="search" placeholder="Tìm theo tên hoặc đơn vị..." value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20" /></div><select value={roleFilter} onChange={(event) => { setRoleFilter(event.target.value as UserRole | "all"); setPage(1); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"><option value="all">Tất cả vai trò</option>{ALL_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></div>{loading ? <div className="flex justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" /></div> : filteredUsers.length === 0 ? <Card className="p-12 text-center"><Users className="mx-auto h-12 w-12 text-slate-300" /><p className="mt-4 text-slate-500">Không tìm thấy tài khoản nào</p></Card> : <><Card className="overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-4 py-3 font-medium">Người dùng</th><th className="px-4 py-3 font-medium">Đơn vị</th><th className="px-4 py-3 font-medium">Vai trò</th><th className="px-4 py-3 font-medium text-right">Ngày tạo</th></tr></thead><tbody className="divide-y divide-slate-100">{paginatedUsers.map((user) => <tr key={user.id} className="hover:bg-slate-50"><td className="px-4 py-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-50 text-sm font-semibold text-teal-700">{user.full_name.charAt(0).toUpperCase() || "?"}</div><div><p className="font-medium text-slate-900">{user.full_name || "Chưa đặt tên"}</p><p className="text-xs text-slate-400">ID: {user.id.slice(0, 8)}...</p></div></div></td><td className="px-4 py-3 text-slate-500">{user.organization || "Chưa cập nhật"}</td><td className="px-4 py-3"><select value={user.role} disabled={updatingId === user.id || user.id === profile.id} title={user.id === profile.id ? "Không thể thay đổi role của chính bạn" : "Thay đổi vai trò"} onChange={(event) => requestRoleChange(user, event.target.value as UserRole)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:cursor-not-allowed disabled:opacity-60">{ALL_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}</select></td><td className="px-4 py-3 text-right text-slate-500">{new Date(user.created_at).toLocaleDateString("vi-VN")}</td></tr>)}</tbody></table></div></Card><div className="flex items-center justify-between text-sm text-slate-500"><span>{filteredUsers.length} tài khoản</span><div className="flex items-center gap-2"><button type="button" aria-label="Trang trước" title="Trang trước" disabled={currentPage === 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-slate-300 p-2 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span>Trang {currentPage}/{totalPages}</span><button type="button" aria-label="Trang tiếp theo" title="Trang tiếp theo" disabled={currentPage === totalPages} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-slate-300 p-2 disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div></div></>}<Modal open={!!pendingChange} onClose={() => { if (!updatingId) setPendingChange(null); }} title="Xác nhận thay đổi vai trò" size="sm">{pendingChange && <div className="space-y-5"><p className="text-sm leading-6 text-slate-600">Bạn sắp thay đổi role của <strong className="text-slate-900">{pendingChange.user.full_name || "người dùng này"}</strong>.</p><div className="flex items-center justify-between rounded-lg bg-slate-50 p-4"><Badge className="bg-slate-200 text-slate-700">{ROLE_LABELS[pendingChange.user.role]}</Badge><span className="text-slate-400">→</span><Badge className="bg-teal-100 text-teal-700"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" />{ROLE_LABELS[pendingChange.role]}</Badge></div><div className="flex justify-end gap-3"><Button variant="outline" disabled={!!updatingId} onClick={() => setPendingChange(null)}>Hủy</Button><Button onClick={confirmRoleChange} disabled={updatingId === pendingChange.user.id}>Xác nhận thay đổi</Button></div></div>}</Modal></div>;
}
