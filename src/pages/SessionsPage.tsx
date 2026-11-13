import { fetchAll } from "@/lib/fetchAll";
import { confirmInsert, insertAttempt, type InsertAttempt } from "@/lib/retryableInsert";
import { AgendaView } from "@/components/AgendaView";
import { useRouter } from "@/context/useRouter";
import { DateInput } from "@/components/ui/DateInput";
import { useEffect, useRef, useState } from "react";
import { toLocalDateTimeInput } from "@/lib/dateInput";
import {
  Plus,
  CalendarClock as ScheduleIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import { getConferenceDisplayStatus } from "@/lib/constants";

import type { Conference, ConferenceCommittee, ConferenceTopic, Session, Paper, Profile } from "@/types";

export function SessionsPage() {
  const { profile } = useAuth();
  const { route, navigate } = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [filterConference, setFilterConference] = useState("");
  const [personalOnly, setPersonalOnly] = useState(route.params.mine === "true");
  const [ownPaperIds, setOwnPaperIds] = useState<Set<string>>(new Set());
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
  const [resourceDeadline,setResourceDeadline]=useState("");
  const [sessionType, setSessionType] = useState<Session["session_type"]>("reporting");
  const [committeeId, setCommitteeId] = useState("");
  const [committees, setCommittees] = useState<ConferenceCommittee[]>([]);
  const [topics, setTopics] = useState<ConferenceTopic[]>([]);
  const [committeeTopicId, setCommitteeTopicId] = useState("");
  const [committeeName, setCommitteeName] = useState("");
  const [committeeRoom, setCommitteeRoom] = useState("");
  const [committeeSaving, setCommitteeSaving] = useState(false);
  const [speakerId, setSpeakerId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [papers, setPapers] = useState<Paper[]>([]);
  const [speakers, setSpeakers] = useState<Profile[]>([]);
  const [paperSpeakers, setPaperSpeakers] = useState<Record<string, Profile[]>>({});
  const [staffByConference, setStaffByConference] = useState<Record<string, Profile[]>>({});
  const [chairId, setChairId] = useState("");
  const [secretaryId, setSecretaryId] = useState("");
  const [saving, setSaving] = useState(false);
  const paperRequest = useRef(0);
  const loadRequest=useRef(0);
  const createAttempt=useRef<InsertAttempt|null>(null);

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
      const { data: confs, error: conferencesError } = await supabase
        .from("conferences")
        .select("*")
        .order("title");
      if (conferencesError) {
        if (!cancelled) showToast("error", `Không thể tải danh sách hội thảo: ${conferencesError.message}`);
      } else if (confs) {
        const ids = profile?.role === "admin"
          ? new Set(confs.map((conference) => conference.id as string))
          : new Set(
              (
                await Promise.all(
                  confs.map(async (conference) => {
                    const { data, error } = await supabase.rpc(
                      "is_conference_organizer",
                      { conf_id: conference.id },
                    );
                    return !error && data === true ? (conference.id as string) : null;
                  }),
                )
              ).filter((id): id is string => id !== null),
            );
        if (!cancelled) {
          setManagedIds(ids);
          setConferences(
            (confs as Conference[]).filter(
              (conference) =>
                ids.has(conference.id) &&
                getConferenceDisplayStatus(conference) !== "completed",
            ),
          );
        }
      }
      const { data: committeeRows } = await supabase
        .from("conference_committees")
        .select("*")
        .order("name");
      if (committeeRows && !cancelled) setCommittees(committeeRows as ConferenceCommittee[]);
      const { data: topicRows } = await supabase
        .from("conference_topics")
        .select("*")
        .order("name");
      if (topicRows && !cancelled) setTopics(topicRows as ConferenceTopic[]);

      const { data: staffRows } = await supabase
        .from("conference_staff")
        .select("conference_id,user_id,user:profile_directory(*)");
      const organizerIds = (confs ?? []).map((conference) => conference.organizer_id).filter(Boolean);
      const { data: organizerRows } = organizerIds.length
        ? await supabase.from("profile_directory").select("*").in("id", organizerIds)
        : { data: [] };
      const eligible: Record<string, Profile[]> = {};
      for (const conference of confs ?? []) {
        const members = (staffRows ?? [])
          .filter((row) => row.conference_id === conference.id)
          .map((row) => row.user as unknown as Profile)
          .filter(Boolean);
        const owner = (organizerRows ?? []).find((row) => row.id === conference.organizer_id) as unknown as Profile | undefined;
        eligible[conference.id] = [...new Map([...members, ...(owner ? [owner] : [])].map((person) => [person.id, person])).values()]
          .sort((left, right) => left.full_name.localeCompare(right.full_name));
      }
      if (!cancelled) setStaffByConference(eligible);
    })();
    return () => { cancelled = true; };
  }, [profile?.id, profile?.role]);

  async function load() {
    const request=++loadRequest.current;
    setLoading(true);
    const { data, error } = await fetchAll((from,to)=>supabase
      .from("sessions")
      .select("*, conference:conferences(*), committee:conference_committees(*)",{count:"exact"})

      .order("start_time", { ascending: true }).order("id").range(from,to));
    if(request!==loadRequest.current)return;
    if (error) {
      showToast("error", "Không thể tải lịch trình");
    } else {
      const rows = (data ?? []) as unknown as Session[];
      const speakerIds = [
        ...new Set(
          rows
            .map((session) => session.speaker_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (speakerIds.length) {
        const speakerResult = await supabase
          .from("profile_directory")
          .select("*")
          .in("id", speakerIds);
        if (speakerResult.error) {
          showToast("error", "Không thể tải thông tin diễn giả");
        } else {
          const speakersById = new Map(
            (speakerResult.data ?? []).map((speaker) => [speaker.id, speaker]),
          );
          for (const session of rows) {
            session.speaker = speakersById.get(session.speaker_id ?? "") as Profile | undefined;
          }
        }
      }
      setSessions(rows);
    }
    setLoading(false);
  }

  async function loadPapers(confId: string, selectedCommitteeId = committeeId) {
    const request = ++paperRequest.current;
    setPapers([]);
    if (!confId) {
      setPapers([]);
      return;
    }
    const committee = committees.find((item) => item.id === selectedCommitteeId);
    let query = supabase.from("papers").select("*", { count: "exact" });
    if (committee?.topic_id) {
      query = supabase
        .from("papers")
        .select("*, paper_topics!inner(topic_id)", { count: "exact" })
        .eq("paper_topics.topic_id", committee.topic_id);
    }
    query = query.eq("conference_id", confId).eq("status", "accepted");

    const { data, error } = await fetchAll((from,to)=>query.order("title").order("id").range(from,to));
    if (request !== paperRequest.current) return;
    if (error) showToast("error", "Không thể tải bài báo của hội thảo");
    else {
      const accepted = (data ?? []) as unknown as Paper[];
      setPapers(accepted);
      const paperIds = accepted.map((paper) => paper.id);
      if (!paperIds.length) {
        setSpeakers([]);
        setPaperSpeakers({});
        return;
      }
      const { data: authorRows, error: authorError } = await supabase
        .from("paper_authors")
        .select("paper_id,user_id,user:profile_directory(*)")
        .in("paper_id", paperIds);
      if (authorError) showToast("error", "Không thể tải tác giả của bài báo");
      else {
        const submittedByIds = [
          ...new Set(
            accepted
              .map((paper) =>
                typeof paper.submitted_by === "string"
                  ? paper.submitted_by
                  : paper.submitted_by?.id,
              )
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const { data: submittedByRows, error: submittedByError } =
          submittedByIds.length
            ? await supabase
                .from("profile_directory")
                .select("*")
                .in("id", submittedByIds)
            : { data: [], error: null };
        if (submittedByError) {
          showToast("error", "Không thể tải tác giả chính của bài báo");
        }
        const submittedByProfiles = (submittedByRows ?? []) as unknown as Profile[];
        const submittedByByPaper = new Map(
          accepted
            .map((paper) => {
              const submittedById =
                typeof paper.submitted_by === "string"
                  ? paper.submitted_by
                  : paper.submitted_by?.id;
              return [
                paper.id,
                submittedByProfiles.find((person) => person.id === submittedById),
              ] as const;
            })
            .filter((entry): entry is [string, Profile] => Boolean(entry[1])),
        );

        const byPaper: Record<string, Profile[]> = {};
        for (const row of authorRows ?? []) {
          const person = row.user as unknown as Profile;
          if (!person) continue;
          byPaper[row.paper_id] = [...(byPaper[row.paper_id] ?? []), person];
        }
        for (const [paperId, person] of submittedByByPaper) {
          byPaper[paperId] = [
            person,
            ...(byPaper[paperId] ?? []).filter((author) => author.id !== person.id),
          ];
        }
        setPaperSpeakers(byPaper);
        setSpeakers([
          ...new Map(
            [
              ...submittedByProfiles,
              ...(authorRows ?? []).map((row) => row.user as unknown as Profile),
            ].map((person) => [person?.id, person]),
          ).values(),
        ].filter(Boolean) as Profile[]);
      }
    }
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
    setRoom(""); setSessionType("reporting"); setResourceDeadline("");

    setCommitteeId("");
    setCommitteeTopicId("");
    setSpeakerId("");
    setPaperId("");
    setChairId("");
    setSecretaryId("");
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
    setRoom(session.room ?? ""); setSessionType(session.session_type ?? "reporting"); setResourceDeadline(session.resource_deadline ? toLocalDateTimeInput(session.resource_deadline) : "");

    setCommitteeId(session.committee_id ?? "");
    setCommitteeTopicId(session.committee?.topic_id ?? "");
    setSpeakerId(session.speaker_id ?? "");
    setPaperId(session.paper_id ?? "");
    setChairId(session.chair_id ?? "");
    setSecretaryId(session.secretary_id ?? "");
    loadPapers(session.conference_id, session.committee_id ?? "");
    setModalOpen(true);
  }

  async function handleSave() {
    if (saving) return;
    if (!managedIds.has(conferenceId) || (editingSession && !managedIds.has(editingSession.conference_id))) {
      showToast('error', 'Bạn không có quyền quản lý lịch trình hội thảo này');
      return;
    }
    if (!conferenceId) {
      showToast("error", "Hội thảo không được để trống");
      return;
    }
    if (!title.trim()) {
      showToast("error", "Tên phiên không được để trống");
      return;
    }
    if (!startTime) {
      showToast("error", "Thời gian bắt đầu không được để trống");
      return;
    }
    if (!endTime) {
      showToast("error", "Thời gian kết thúc không được để trống");
      return;
    }
    if (sessionType === "reporting" && !committeeId) {
      showToast("error", "Phiên báo cáo phải chọn tiểu ban");
      return;
    }
    if (new Date(endTime) <= new Date(startTime)) {
      showToast("error", "Thời gian kết thúc phải sau thời gian bắt đầu");
      return;
    }
    if (Number.isNaN(new Date(startTime).getTime()) || Number.isNaN(new Date(endTime).getTime())) {
      showToast("error", "Thời gian phiên không hợp lệ");
      return;
    }
    const selectedConference = conferences.find((conference) => conference.id === conferenceId);
    if (selectedConference) {
      const sessionStart = new Date(startTime);
      const sessionEnd = new Date(endTime);
      const conferenceStart = new Date(selectedConference.start_date);
      const conferenceEnd = new Date(selectedConference.end_date);
      if (sessionStart < conferenceStart || sessionEnd > conferenceEnd) {
        showToast("error", "Thời gian phiên phải nằm trong thời gian hội thảo");
        return;
      }
      if (resourceDeadline && new Date(resourceDeadline) > sessionStart) {
        showToast("error", "Hạn tải slide/tài liệu phải trước hoặc đúng giờ bắt đầu phiên");
        return;
      }
    }
    if (sessionType !== "reporting" && (committeeId || paperId || speakerId)) {
      showToast("error", "Phiên khai mạc/bế mạc không được gắn tiểu ban, bài báo hoặc báo cáo viên");
      return;
    }
    if (sessionType === "reporting" && chairId && !(staffByConference[conferenceId] ?? []).some((person) => person.id === chairId)) {
      showToast("error", "Chủ trì phải thuộc ban tổ chức của hội thảo");
      return;
    }
    if (sessionType === "reporting" && secretaryId && !(staffByConference[conferenceId] ?? []).some((person) => person.id === secretaryId)) {
      showToast("error", "Thư ký phải thuộc ban tổ chức của hội thảo");
      return;
    }
    setSaving(true);
    try {
    const startIso = new Date(startTime).toISOString();
    const endIso = new Date(endTime).toISOString();
    const duplicateQuery = supabase
      .from("sessions")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("title", title.trim())
      .eq("start_time", startIso)
      .eq("end_time", endIso)
      .eq("room", room.trim())
      .limit(1);
    const { data: duplicateRows, error: duplicateError } = editingSession
      ? await duplicateQuery.neq("id", editingSession.id)
      : await duplicateQuery;
    if (duplicateError) {
      showToast("error", `Không thể kiểm tra phiên trùng: ${duplicateError.message}`);
      return;
    }
    if (duplicateRows?.length) {
      showToast("error", "Phiên này đã tồn tại trong hội thảo và phòng đã chọn");
      return;
    }
    const payload = {
      conference_id: conferenceId,
      title: title.trim(),
      description: description.trim(),
      start_time: startIso,
      end_time: endIso,
      room: room.trim(),
      resource_deadline: resourceDeadline ? new Date(resourceDeadline).toISOString() : null,
      session_type: sessionType,
      committee_id: sessionType === "reporting" ? committeeId || null : null,
      speaker_id: speakerId || null,
      paper_id: sessionType === "reporting" ? paperId || null : null,
      chair_id: sessionType === "reporting" ? chairId || null : null,
      secretary_id: sessionType === "reporting" ? secretaryId || null : null,
    };

    if (editingSession) {
      const { error } = await supabase
        .from("sessions")
        .update(payload)
        .eq("id", editingSession.id).select("id").single();
      if (error) {
        showToast("error", formatSessionSaveError(error));
      } else {
        showToast("success", "Cập nhật phiên thành công");
        setModalOpen(false);
        load();
      }
    } else {
      createAttempt.current=insertAttempt(createAttempt.current,payload);
      const id=createAttempt.current.id;
      await confirmInsert(()=>supabase.from("sessions").insert({...payload,id}),()=>supabase.from("sessions").select("id").eq("id",id).maybeSingle());
      createAttempt.current=null;
      showToast("success", "Tạo phiên thành công");
      setModalOpen(false);
      void load();
    }
    } catch (error) {
      const message =
        error &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
          ? error.message
          : "Vui lòng thử lại.";
      showToast("error", `Không thể lưu lịch trình: ${formatSessionSaveError(error, message)}`);
    } finally {
      setSaving(false);
    }

    function formatSessionSaveError(error: unknown, fallback = "Vui lòng thử lại.") {
      const message = error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : fallback;
      if (message.includes("Tiểu ban không thuộc hội thảo")) return "Tiểu ban đã chọn không thuộc hội thảo này.";
      if (message.includes("Bài báo phải được chấp nhận")) return "Bài báo phải được chấp nhận và đúng chủ đề của tiểu ban.";
      if (message.includes("Báo cáo viên phải là tác giả")) return "Báo cáo viên phải là tác giả của bài báo đã chọn.";
      if (message.includes("Chủ trì phải thuộc")) return "Chủ trì phải thuộc ban tổ chức của hội thảo.";
      if (message.includes("Thư ký phải thuộc")) return "Thư ký phải thuộc ban tổ chức của hội thảo.";
      if (message.includes("duplicate key") || message.includes("sessions_")) return "Phiên này đã tồn tại.";
      return message;
    }
  }

  async function handleCreateCommittee(event: React.FormEvent) {
    event.preventDefault();
    if (!conferenceId || !committeeName.trim() || !committeeTopicId || !managedIds.has(conferenceId) || committeeSaving) return;
    setCommitteeSaving(true);
    const { data, error } = await supabase.from("conference_committees").insert({
      conference_id: conferenceId,
      name: committeeName.trim(),
      room: committeeRoom.trim(),
      topic_id: committeeTopicId || null,
    }).select().single();
    if (error) showToast("error", "Tạo tiểu ban thất bại: " + error.message);
    else {
      setCommittees((current) => [...current, data as ConferenceCommittee].sort((left, right) => left.name.localeCompare(right.name)));
      setCommitteeName("");
      setCommitteeRoom("");
      setCommitteeTopicId("");
      showToast("success", "Đã tạo tiểu ban");
    }
    setCommitteeSaving(false);
  }

  async function handleDelete(id: string) {
    const target = sessions.find((session) => session.id === id);
    if (!target || !managedIds.has(target.conference_id)) return;
    if (!confirm("Xóa phiên này?")) return;
    try {
    const { error } = await supabase.from("sessions").delete().eq("id", id).select("id").single();
    if (error) {
      showToast("error", "Xóa thất bại");
    } else {
      showToast("success", "Đã xóa phiên");
      void load();
    }
    } catch {showToast("error","Chưa xác nhận kết quả xóa phiên. Tải lại lịch trình trước khi thử lại.");}
  }

  const personalIds = new Set(sessions.filter((session) => session.speaker_id === profile?.id || (session.paper_id && ownPaperIds.has(session.paper_id))).flatMap((session) => [session.id, ...(session.parent_session_id ? [session.parent_session_id] : [])]));
  const activeSessions = sessions.filter(
    (session) =>
      !session.conference ||
      getConferenceDisplayStatus(session.conference) !== "completed",
  );
  const visibleSessions = activeSessions.filter((session) => (!filterConference || session.conference_id === filterConference) && (!personalOnly || personalIds.has(session.id)));
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
          {[...new Map(activeSessions.map((session) => [session.conference_id, session.conference?.title ?? session.conference_id])).entries()].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={personalOnly} onChange={(event) => setPersonalOnly(event.target.checked)} />Lịch của tôi (diễn giả / tác giả)</label>
      </Card>
      {canEdit && <Card className="p-4">
        <h2 className="font-semibold text-slate-900">Tiểu ban và phòng song song</h2>
        <p className="mt-1 text-sm text-slate-500">Chỉ tạo tiểu ban khi hội thảo có nhiều phòng hoặc nhiều nhóm chủ đề. Nếu chỉ có một phòng, bạn có thể tạo phiên trực tiếp mà không cần tiểu ban.</p>
        <form onSubmit={handleCreateCommittee} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <Select aria-label="Hội thảo của tiểu ban" value={conferenceId} onChange={(event) => setConferenceId(event.target.value)}>
            <option value="">Chọn hội thảo</option>
            {conferences.map((conference) => <option key={conference.id} value={conference.id}>{conference.title}</option>)}
          </Select>
          <Input aria-label="Tên tiểu ban" placeholder="Tên tiểu ban" value={committeeName} onChange={(event) => setCommitteeName(event.target.value)} />
          <Input aria-label="Phòng tiểu ban" placeholder="Phòng" value={committeeRoom} onChange={(event) => setCommitteeRoom(event.target.value)} />

          <Select aria-label="Chủ đề của tiểu ban" required value={committeeTopicId} onChange={(event) => setCommitteeTopicId(event.target.value)}>
            <option value="">Chọn chủ đề</option>
            {topics.filter((topic) => topic.conference_id === conferenceId).map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </Select>
          <Button type="submit" disabled={committeeSaving}><Plus className="h-4 w-4" /> Thêm</Button>
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
          <AgendaView
            sessions={visibleSessions}
            canEditSession={(session) => managedIds.has(session.conference_id)}
            onEdit={openEdit}
            onDelete={(id) => void handleDelete(id)}
          />
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => { if (!saving) setModalOpen(false); }}
        closeOnBackdrop={false}
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
              setCommitteeTopicId("");
              setSpeakerId("");
              setChairId("");
              setSecretaryId("");
              loadPapers(e.target.value, "");
            }}
          >
            <option value="">Chọn hội thảo</option>
            {conferences.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
          {conferenceId && (() => {
            const selectedConference = conferences.find((conference) => conference.id === conferenceId);
            if (!selectedConference) return null;
            const formatDateTime = (value: string) => new Date(value).toLocaleString("vi-VN", {
              dateStyle: "short",
              timeStyle: "short",
            });
            return (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                <p className="font-semibold">Thời gian hội thảo</p>
                <p className="mt-1">
                  Bắt đầu: {formatDateTime(selectedConference.start_date)}
                  {" · "}
                  Kết thúc: {formatDateTime(selectedConference.end_date)}
                </p>
                <p className="mt-1">
                  Phiên và hạn tải slide/tài liệu phải nằm trong khoảng thời gian này.
                </p>
              </div>
            );
          })()}
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
          <DateInput label="Hạn tải slide/tài liệu (mặc định: giờ bắt đầu phiên)" type="datetime-local" value={resourceDeadline} onValueChange={setResourceDeadline} />

          <Select label="Loại phiên *" value={sessionType} onChange={(event) => {
            const nextType = event.target.value as Session["session_type"];
            setSessionType(nextType);
            if (nextType !== "reporting") {
              setCommitteeId("");
              setCommitteeTopicId("");
              setPaperId("");
              setSpeakerId("");
            }
          }}>
            <option value="opening">Phiên khai mạc</option>
            <option value="reporting">Phiên báo cáo</option>
            <option value="closing">Phiên bế mạc</option>
          </Select>
          {sessionType === "reporting" && <><Select label="Tiểu ban (không bắt buộc)" value={committeeId} onChange={(event) => {

            const nextId = event.target.value;
            setCommitteeId(nextId);
            const committee = committees.find((item) => item.id === nextId);
            setCommitteeTopicId(committee?.topic_id ?? "");
            if (committee?.room) setRoom(committee.room);
            setPaperId("");
            setSpeakerId("");
            void loadPapers(conferenceId, nextId);
          }}>
            <option value="">Chọn tiểu ban</option>
            {committees.filter((committee) => committee.conference_id === conferenceId).map((committee) => <option key={committee.id} value={committee.id}>{committee.name}{committee.room ? ` · ${committee.room}` : ""}</option>)}
          </Select>
          <Select
            label="Chủ trì"
            value={chairId}
            onChange={(event) => setChairId(event.target.value)}
          >
            <option value="">-- Chưa chọn --</option>
            {(staffByConference[conferenceId] ?? []).map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
          </Select>
          <Select
            label="Thư ký"
            value={secretaryId}
            onChange={(event) => setSecretaryId(event.target.value)}
          >
            <option value="">-- Chưa chọn --</option>
            {(staffByConference[conferenceId] ?? []).map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
          </Select>
          <Select
            label="Báo cáo viên"
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
          >
            <option value="">-- Không chọn --</option>
            {(paperId ? paperSpeakers[paperId] ?? [] : speakers).map((s) => (
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
          </>}
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
