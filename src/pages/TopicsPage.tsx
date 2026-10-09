import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useConferenceAccess } from "@/context/useConferenceAccess";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import type { Conference, ConferenceTopic } from "@/types";

export function TopicsPage() {
  const { conferences, canManage } = useConferenceAccess();
  const { profile } = useAuth();
  const [mineOnly, setMineOnly] = useState(false);
  const [creators, setCreators] = useState<Record<string, string>>({});
  const [conferenceId, setConferenceId] = useState("");
  const [topics, setTopics] = useState<ConferenceTopic[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void supabase.from("profile_directory").select("id, full_name").then(({ data }) => setCreators(Object.fromEntries((data ?? []).map((user) => [user.id, user.full_name]))));
  }, []);
  const visibleTopics = topics.filter((topic) => !mineOnly || topic.created_by === profile?.id);
  const selectedConference = conferences.find((conference) => conference.id === conferenceId);

  useEffect(() => {
    if (!conferenceId) { setTopics([]); return; }
    void loadTopics(conferenceId);
  }, [conferenceId]);

  async function loadTopics(id: string) {
    const { data, error } = await supabase.from("conference_topics").select("*").eq("conference_id", id).order("name");
    if (error) showToast("error", "Không thể tải chủ đề: " + error.message);
    else setTopics((data ?? []) as ConferenceTopic[]);
  }

  async function addTopic(event: React.FormEvent) {
    event.preventDefault();
    if (!conferenceId || !name.trim() || !canManage(conferenceId) || loading) return;
    setLoading(true);
    const result = editingId
      ? await supabase.from("conference_topics").update({ name: name.trim(), description: description.trim() }).eq("id", editingId)
      : await supabase.from("conference_topics").insert({ conference_id: conferenceId, name: name.trim(), description: description.trim(), created_by: profile?.id });
    if (result.error) showToast("error", "Không thể lưu chủ đề: " + result.error.message);
    else { showToast("success", editingId ? "Đã cập nhật chủ đề" : "Đã thêm chủ đề"); setName(""); setDescription(""); setEditingId(null); await loadTopics(conferenceId); }
    setLoading(false);
  }

  async function removeTopic(topic: ConferenceTopic) {
    if (!canManage(topic.conference_id) || !window.confirm(`Xóa chủ đề ${topic.name}?`)) return;
    const { error } = await supabase.from("conference_topics").delete().eq("id", topic.id);
    if (error) showToast("error", "Không thể xóa chủ đề. Có thể chủ đề đang được gắn với bài báo.");
    else { showToast("success", "Đã xóa chủ đề"); await loadTopics(topic.conference_id); }
  }

  function editTopic(topic: ConferenceTopic) {
    setEditingId(topic.id);
    setName(topic.name);
    setDescription(topic.description);
  }

  return <div className="space-y-6">
    <header><h1 className="text-2xl font-bold text-slate-900">Quản lý chủ đề</h1><p className="mt-1 text-sm text-slate-500">Tạo chủ đề riêng cho từng hội thảo để phân loại bài báo.</p></header>
    <Card className="p-5">
      <Select label="Hội thảo" value={conferenceId} onChange={(event) => { setConferenceId(event.target.value); setEditingId(null); setName(""); setDescription(""); }}><option value="">Chọn hội thảo</option>{conferences.map((conference: Conference) => <option key={conference.id} value={conference.id}>{conference.title}</option>)}</Select>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={mineOnly} onChange={(event) => setMineOnly(event.target.checked)} />Chủ đề do tôi tạo</label>
      {selectedConference && <form onSubmit={addTopic} className="mt-5 space-y-4 border-t border-slate-200 pt-5"><Input label="Tên chủ đề" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Trí tuệ nhân tạo ứng dụng" /><Textarea label="Mô tả" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Mô tả ngắn về chủ đề" /><div className="flex gap-2"><Button type="submit" disabled={loading}>{editingId ? "Lưu thay đổi" : <><Plus className="h-4 w-4" /> Thêm chủ đề</>}</Button>{editingId && <Button type="button" variant="outline" onClick={() => { setEditingId(null); setName(""); setDescription(""); }}>Hủy sửa</Button>}</div></form>}
    </Card>
    {conferenceId && <Card className="p-5"><h2 className="font-semibold text-slate-900">Chủ đề của hội thảo</h2>{visibleTopics.length === 0 ? <p className="mt-4 text-sm text-slate-500">Chưa có chủ đề nào.</p> : <div className="mt-4 divide-y divide-slate-100">{visibleTopics.map((topic) => <div key={topic.id} className="flex items-start justify-between gap-4 py-3"><div><p className="font-medium text-slate-800">{topic.name}</p><p className="mt-1 text-xs text-slate-500">Người tạo: {topic.created_by ? creators[topic.created_by] ?? "Người dùng" : "Chủ đề hệ thống"}</p>{topic.description && <p className="mt-1 text-sm text-slate-500">{topic.description}</p>}</div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => editTopic(topic)}>Sửa</Button><Button type="button" variant="outline" size="sm" onClick={() => removeTopic(topic)} aria-label={`Xóa ${topic.name}`}><Trash2 className="h-4 w-4" /></Button></div></div>)}</div>}</Card>}
  </div>;
}