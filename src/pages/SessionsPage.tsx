import { AgendaView } from "@/components/AgendaView";
import { useRouter } from "@/context/useRouter";
import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useRef, useState } from "react";
import { toLocalDateTimeInput } from "@/lib/dateInput";
import {
  Plus,
  Clock,
  MapPin,
  User,
  Calendar,
  Trash2,
  Pencil,
  CalendarClock as ScheduleIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import type { Conference, ConferenceCommittee, Session, Paper, Profile } from "@/types";

export function SessionsPage() {
  const { profile } = useAuth();
  const { route, navigate } = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filterConference, setFilterConference] = useState("");
  const [personalOnly, setPersonalOnly] = useState(route.params.mine === "true");
  const [ownPaperIds, setOwnPaperIds] = useState<Set<string>>(new Set());
  const [parentSessionId, setParentSessionId] = useState("");
  const [conferences, setConferences] = useState<Conference[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSession, setEditingSession] = useState<Session | null>(null);

  // form state
  const [conferenceId, setConferenceId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [room, setRoom] = useState("");
  const [tags, setTags] = useState("");
  const [resourceDeadline,setResourceDeadline]=useState("");
  const [difficulty,setDifficulty] = useState<"general"|"beginner"|"advanced">("general");
  const [committeeId, setCommitteeId] = useState("");
  const [committees, setCommittees] = useState<ConferenceCommittee[]>([]);
  const [committeeName, setCommitteeName] = useState("");
  const [committeeRoom, setCommitteeRoom] = useState("");
  const [committeeSaving, setCommitteeSaving] = useState(false);
  const [speakerId, setSpeakerId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [speakers, setSpeakers] = useState<Profile[]>([]);
  const [saving, setSaving] = useState(false);
  const paperRequest = useRef(0);

  const [managedIds, setManagedIds] = useState<Set<string>>(new Set());
  const canEdit = managedIds.size > 0;

  useEffect(() => {
    let cancelled = false;
    setManagedIds(new Set());
    load();
    setOwnPaperIds(new Set());
    (async () => {
      if (profile?.id) {
        const [submitted, coauthored] = await Promise.all([
          supabase.from("papers").select("id").eq("submitted_by", profile.id),
          supabase.from("paper_authors").select("paper_id").eq("user_id", profile.id),
        ]);
        if (submitted.error || coauthored.error) showToast("error", "Không thể tải lịch cá nhân");
        if (!cancelled) setOwnPaperIds(new Set([...(submitted.data ?? []).map((paper) => paper.id), ...(coauthored.data ?? []).map((author) => author.paper_id)]));
      }
      const { data: confs } = await supabase
        .from("conferences")
        .select("*")
        .order("title");
      if (confs) {
        const permissions = await Promise.all(confs.map(async (conference) => {
          const { data, error } = await supabase.rpc('is_conference_organizer', { conf_id: conference.id });
          return !error && data === true ? conference.id as string : null;
        }));
        const ids = new Set(permissions.filter((id): id is string => id !== null));
        if (!cancelled) {
          setManagedIds(ids);
          setConferences((confs as Conference[]).filter((conference) => ids.has(conference.id)));
        }
      }
      const { data: profs } = await supabase
        .from("profile_directory")
        .select("*")
        .in("role", ["admin", "organizer", "author", "reviewer", "participant"])
        .order("full_name");
      if (profs && !cancelled) setSpeakers(profs as unknown as Profile[]);
      const { data: committeeRows } = await supabase
        .from("conference_committees")
        .select("*")
        .order("name");
      if (committeeRows && !cancelled) setCommittees(committeeRows as ConferenceCommittee[]);
    })();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.role]);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("sessions")
      .select("*, conference:conferences(*), speaker:profile_directory(*), committee:conference_committees(*)")
      .order("start_time", { ascending: true });
    if (error) {
      showToast("error", "Không thể tải lịch trình");
    } else {
      setSessions((data ?? []) as unknown as Session[]);
    }
    setLoading(false);
  }

  async function loadPapers(confId: string) {
    const request = ++paperRequest.current;
    setPapers([]);
    if (!confId) {
      setPapers([]);
      return;
    }
    const { data, error } = await supabase
      .rpc('read_papers')
      .eq("conference_id", confId)
      .eq("status", "accepted")
      .select("*")
      .order("title");
    if (request !== paperRequest.current) return;
    if (error) showToast("error", "Không thể tải bài báo của hội thảo");
    else setPapers((data ?? []) as unknown as Paper[]);
  }

  function openCreate() {
    paperRequest.current++;
    if (!canEdit) return;
    setEditingSession(null);
    setConferenceId("");
    setTitle("");
    setDescription("");
    setStartTime("");
    setEndTime("");
    setRoom(""); setTags(""); setDifficulty("general"); setResourceDeadline("");
    setCommitteeId("");
    setParentSessionId("");
    setSpeakerId("");
    setPaperId("");
    setPapers([]);
    setModalOpen(true);
  }

  function openEdit(session: Session) {
    if (!managedIds.has(session.conference_id)) return;
    setEditingSession(session);
    setConferenceId(session.conference_id);
    setTitle(session.title);
    setDescription(session.description ?? "");
    setStartTime(toLocalDateTimeInput(session.start_time));
    setEndTime(toLocalDateTimeInput(session.end_time));
    setRoom(session.room ?? ""); setTags((session.tags ?? []).join(", ")); setDifficulty(session.difficulty ?? "general"); setResourceDeadline(session.resource_deadline ? toLocalDateTimeInput(session.resource_deadline) : "");
    setCommitteeId(session.committee_id ?? "");
    setParentSessionId(session.parent_session_id ?? "");
    setSpeakerId(session.speaker_id ?? "");
    setPaperId(session.paper_id ?? "");
    loadPapers(session.conference_id);
    setModalOpen(true);
  }

  async function handleSave() {
    if (saving) return;
    if (!managedIds.has(conferenceId) || (editingSession && !managedIds.has(editingSession.conference_id))) {
      showToast('error', 'Bạn không có quyền quản lý lịch trình hội thảo này');
      return;
    }
    if (!conferenceId || !title.trim() || !startTime || !endTime) {
      showToast("error", "Vui lòng điền đầy đủ thông tin");
      return;
    }
    if (new Date(endTime) <= new Date(startTime)) {
      showToast("error", "Thời gian kết thúc phải sau thời gian bắt đầu");
      return;
    }
    setSaving(true);
    try {
    const payload = {
      conference_id: conferenceId,
      title: title.trim(),
      description: description.trim(),
      start_time: new Date(startTime).toISOString(),
      end_time: new Date(endTime).toISOString(),
      room: room.trim(),
      tags: [...new Set(tags.split(",").map((tag)=>tag.trim()).filter(Boolean))], difficulty,
      resource_deadline: resourceDeadline ? new Date(resourceDeadline).toISOString() : null,
      committee_id: committeeId || null,
      parent_session_id: parentSessionId || null,
      speaker_id: speakerId || null,
      paper_id: paperId || null,
    };

    if (editingSession) {
      const { error } = await supabase
        .from("sessions")
        .update(payload)
        .eq("id", editingSession.id);
      if (error) {
        showToast("error", "Cập nhật thất bại: " + error.message);
      } else {
        showToast("success", "Cập nhật phiên thành công");
        setModalOpen(false);
        load();
      }
    } else {
      const { error } = await supabase.from("sessions").insert(payload);
      if (error) {
        showToast("error", "Tạo phiên thất bại: " + error.message);
      } else {
        showToast("success", "Tạo phiên thành công");
        setModalOpen(false);
        load();
      }
    }
    } catch {
      showToast("error", "Không thể lưu lịch trình. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateCommittee(event: React.FormEvent) {
    event.preventDefault();
    if (!conferenceId || !committeeName.trim() || !managedIds.has(conferenceId) || committeeSaving) return;
    setCommitteeSaving(true);
    const { data, error } = await supabase.from("conference_committees").insert({
      conference_id: conferenceId,
      name: committeeName.trim(),
      room: committeeRoom.trim(),
    }).select().single();
    if (error) showToast("error", "Tạo tiểu ban thất bại: " + error.message);
    else {
      setCommittees((current) => [...current, data as ConferenceCommittee].sort((left, right) => left.name.localeCompare(right.name)));
      setCommitteeName("");
      setCommitteeRoom("");
      showToast("success", "Đã tạo tiểu ban");
    }
    setCommitteeSaving(false);
  }

  async function handleDelete(id: string) {
    const target = sessions.find((session) => session.id === id);
    if (!target || !managedIds.has(target.conference_id)) return;
    if (!confirm("Xóa phiên này?")) return;
    const { error } = await supabase.from("sessions").delete().eq("id", id);
    if (error) {
      showToast("error", "Xóa thất bại");
    } else {
      showToast("success", "Đã xóa phiên");
      load();
    }
  }

  // group sessions by conference
  const personalIds = new Set(sessions.filter((session) => session.speaker_id === profile?.id || (session.paper_id && ownPaperIds.has(session.paper_id))).flatMap((session) => [session.id, ...(session.parent_session_id ? [session.parent_session_id] : [])]));
  const visibleSessions = sessions.filter((session) => (!filterConference || session.conference_id === filterConference) && (!personalOnly || personalIds.has(session.id)));
  const grouped = visibleSessions.reduce(
    (acc, s) => {
      const key = s.conference_id;
      if (!acc[key]) acc[key] = [];
      acc[key].push(s);
      return acc;
    },
    {} as Record<string, Session[]>,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lịch trình</h1>
          <p className="mt-1 text-sm text-slate-500">
            Các phiên báo cáo và diễn giả
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> Tạo phiên
          </Button>
        )}
      </div>

      <Card className="flex flex-wrap items-center gap-4 p-4">
        <Select label="Hội thảo" value={filterConference} onChange={(event) => setFilterConference(event.target.value)}>
          <option value="">Tất cả hội thảo</option>
          {[...new Map(sessions.map((session) => [session.conference_id, session.conference?.title ?? session.conference_id])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={personalOnly} onChange={(event) => setPersonalOnly(event.target.checked)} />Lịch của tôi (diễn giả / tác giả)</label>
      </Card>
      {canEdit && <Card className="p-4">
        <h2 className="font-semibold text-slate-900">Tiểu ban và phòng song song</h2>
        <p className="mt-1 text-sm text-slate-500">Tạo nhiều tiểu ban cho cùng hội thảo; mỗi tiểu ban có thể diễn ra ở một phòng riêng.</p>
        <form onSubmit={handleCreateCommittee} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Select aria-label="Hội thảo của tiểu ban" value={conferenceId} onChange={(event) => setConferenceId(event.target.value)}>
            <option value="">Chọn hội thảo</option>
            {conferences.map((conference) => <option key={conference.id} value={conference.id}>{conference.title}</option>)}
          </Select>
          <Input aria-label="Tên tiểu ban" placeholder="Tên tiểu ban" value={committeeName} onChange={(event) => setCommitteeName(event.target.value)} />
          <div className="flex gap-2"><Input aria-label="Phòng tiểu ban" placeholder="Phòng" value={committeeRoom} onChange={(event) => setCommitteeRoom(event.target.value)} /><Button type="submit" disabled={committeeSaving}><Plus className="h-4 w-4" /> Thêm</Button></div>
        </form>
        {committees.filter((committee) => committee.conference_id === conferenceId).length > 0 && <div className="mt-4 flex flex-wrap gap-2">{committees.filter((committee) => committee.conference_id === conferenceId).map((committee) => <span key={committee.id} className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-800">{committee.name}{committee.room ? ` · ${committee.room}` : ""}</span>)}</div>}
      </Card>}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600" />
        </div>
      ) : visibleSessions.length === 0 ? (
        <Card className="p-12 text-center">
          <ScheduleIcon className="mx-auto h-12 w-12 text-slate-300" />
          <p className="mt-4 text-slate-500">Chưa có phiên nào được tạo</p>
        </Card>
      ) : (
        <div className="space-y-6">
          <AgendaView sessions={visibleSessions} />
          {canEdit && Object.entries(grouped).map(([confId, sess]) => (
            <div key={confId}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Calendar className="h-4 w-4 text-teal-600" />
                {sess[0]?.conference?.title ?? "Hội thảo"}
              </h2>
              <div className="space-y-3">
                {sess.map((session) => (
                  <Card key={session.id} className={session.parent_session_id ? "ml-4 border-l-4 border-l-teal-400 p-4" : "border-l-4 border-l-teal-700 bg-teal-50/40 p-4"}>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <h3 className="font-medium text-slate-900">
                          {session.title}
                        </h3>
                        <button type="button" className="mt-1 text-sm text-teal-700 hover:underline" onClick={()=>navigate("session-detail",{id:session.id})}>Chi tiết · Tài liệu · Điểm danh</button>
                        {session.parent_session_id && <p className="mt-1 text-xs text-teal-700">Thuộc phiên: {sessions.find((parent) => parent.id === session.parent_session_id)?.title}</p>}
                        {session.committee && <p className="mt-1 text-sm font-medium text-teal-700">Tiểu ban: {session.committee.name}</p>}
                        {session.description && (
                          <p className="mt-1 text-sm text-slate-500">
                            {session.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {new Date(session.start_time).toLocaleString(
                              "vi-VN",
                              { dateStyle: "short", timeStyle: "short" },
                            )}
                            {" - "}
                            {new Date(session.end_time).toLocaleTimeString(
                              "vi-VN",
                              { timeStyle: "short" },
                            )}
                          </span>
                          {session.room && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3.5 w-3.5" />
                              {session.room}
                            </span>
                          )}
                          {session.speaker && (
                            <span className="flex items-center gap-1">
                              <User className="h-3.5 w-3.5" />
                              {session.speaker.full_name}
                            </span>
                          )}
                        </div>
                      </div>
                      {managedIds.has(session.conference_id) && (
                        <div className="flex gap-1">
                          <button
                            onClick={() => openEdit(session)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(session.id)}
                            className="rounded-lg p-2 text-rose-400 hover:bg-rose-50 hover:text-rose-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { if (!saving) setModalOpen(false); }}
        title={editingSession ? "Chỉnh sửa phiên" : "Tạo phiên mới"}
        size="md"
      >
        <fieldset disabled={saving} className="space-y-4">
          <Select
            label="Hội thảo *"
            value={conferenceId}
            onChange={(e) => {
              setConferenceId(e.target.value);
              setPaperId("");
              setCommitteeId("");
              setParentSessionId("");
              loadPapers(e.target.value);
            }}
          >
            <option value="">Chọn hội thảo</option>
            {conferences.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          <Input
            label="Tên phiên *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tên phiên báo cáo"
          />
          <Textarea
            label="Mô tả"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-4">
            <DateInput
              label="Bắt đầu *"
              type="datetime-local"
              value={startTime}
              onValueChange={setStartTime}
             />
            <DateInput
              label="Kết thúc *"
              type="datetime-local"
              value={endTime}
              onValueChange={setEndTime}
             />
          </div>
          <Input
            label="Phòng"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          />
          <DateInput label="Hạn tải slide (mặc định: giờ bắt đầu phiên)" type="datetime-local" value={resourceDeadline} onValueChange={setResourceDeadline} />
          <Input label="Chủ đề / tags (cách nhau bởi dấu phẩy)" value={tags} onChange={(event)=>setTags(event.target.value)} />
          <Select label="Mức độ workshop" value={difficulty} onChange={(event)=>setDifficulty(event.target.value as typeof difficulty)}><option value="general">Chung</option><option value="beginner">Cơ bản</option><option value="advanced">Nâng cao</option></Select>
          <Select label="Phiên chung (cho báo cáo song song)" value={parentSessionId} onChange={(event) => setParentSessionId(event.target.value)}>
            <option value="">Phiên độc lập / phiên chung</option>
            {sessions.filter((session) => session.conference_id === conferenceId && !session.parent_session_id && session.id !== editingSession?.id).map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
          </Select>
          <Select label="Tiểu ban" value={committeeId} onChange={(event) => {
            const nextId = event.target.value;
            setCommitteeId(nextId);
            const committee = committees.find((item) => item.id === nextId);
            if (committee?.room) setRoom(committee.room);
          }}>
            <option value="">Không thuộc tiểu ban</option>
            {committees.filter((committee) => committee.conference_id === conferenceId).map((committee) => <option key={committee.id} value={committee.id}>{committee.name}{committee.room ? ` · ${committee.room}` : ""}</option>)}
          </Select>
          <Select
            label="Diễn giả"
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
          >
            <option value="">-- Không chọn --</option>
            {speakers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </Select>
          <Select
            label="Bài báo liên kết"
            value={paperId}
            onChange={(e) => setPaperId(e.target.value)}
          >
            <option value="">-- Không chọn --</option>
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </Select>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Hủy
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Đang lưu..." : "Lưu"}
            </Button>
          </div>
        </fieldset>
      </Modal>
    </div>
  );
}
