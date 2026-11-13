import {useCallback,useEffect,useState} from "react";
import {supabase} from "@/lib/supabase";
import {useAuth} from "@/context/useAuth";
import {useRouter} from "@/context/useRouter";
import {useConferenceAccess} from "@/context/useConferenceAccess";
import {ResourceCenter} from "@/components/ResourceCenter";
import {Card} from "@/components/ui/Card";
import {Button} from "@/components/ui/Button";
import {Select,Textarea} from "@/components/ui/Field";
import {showToast} from "@/components/ui/toastStore";
import type {Session} from "@/types";

interface Attendance {checked_in_at:string;checked_out_at:string|null}
interface Summary {responses:number;speaker_average:number|null;content_average:number|null}
export function SessionDetailPage(){
  const {route,navigate}=useRouter();const {profile}=useAuth();const {canManage}=useConferenceAccess();const id=route.params.id;
  const [session,setSession]=useState<Session|null>(null);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  const [attendance,setAttendance]=useState<Attendance|null>(null);const [busy,setBusy]=useState(false);
  const [feedbackSent,setFeedbackSent]=useState(false);const [speakerRating,setSpeakerRating]=useState("5");const [contentRating,setContentRating]=useState("5");const [comment,setComment]=useState("");const [summary,setSummary]=useState<Summary|null>(null);
  const load=useCallback(async()=>{
    setLoading(true);setError("");
    try{
      const result=await supabase.from("sessions").select("*,conference:conferences(*)").eq("id",id).maybeSingle();
      if(result.error||!result.data)throw new Error("Không tìm thấy phiên hoặc bạn chưa có quyền xem lịch này");
      const session=result.data as Session;
      if (session.speaker_id) {
        const speakerResult = await supabase
          .from("profile_directory")
          .select("*")
          .eq("id", session.speaker_id)
          .maybeSingle();
        if (speakerResult.error) {
          throw new Error(`Không thể tải thông tin diễn giả: ${speakerResult.error.message}`);
        }
        session.speaker = speakerResult.data as Session["speaker"];
      }

      if (session.paper_id) {
        const paperResult=await supabase.from("papers").select("*").eq("id",session.paper_id).maybeSingle();
        if (paperResult.error) throw new Error(`Không thể tải thông tin bài báo: ${paperResult.error.message}`);
        session.paper=paperResult.data;
      }
      setSession(session);
      const [attendanceResult,feedbackResult]=await Promise.all([supabase.from("session_attendance").select("checked_in_at,checked_out_at").eq("session_id",id).eq("user_id",profile!.id).maybeSingle(),supabase.from("session_feedback").select("session_id").eq("session_id",id).eq("user_id",profile!.id).maybeSingle()]);
      if(attendanceResult.error||feedbackResult.error)throw new Error("Không thể tải dữ liệu khảo sát. Kiểm tra bản cập nhật hệ thống.");
      setAttendance(attendanceResult.data);setFeedbackSent(!!feedbackResult.data);
    }catch(error){setError(error instanceof Error?error.message:"Không thể tải phiên");}finally{setLoading(false);}
  },[id,profile]);
  useEffect(()=>{if(profile?.id)void load();},[load,profile?.id]);
  const manager=!!session&&canManage(session.conference_id);
  useEffect(()=>{
    if(!manager)return;
    let cancelled=false;
    void supabase.rpc("session_feedback_summary",{target_session_id:id}).then(({data,error})=>{if(!cancelled){if(error)showToast("error","Không thể tải kết quả khảo sát");else setSummary(data?.[0]??null);}});
    return()=>{cancelled=true;};
  },[id,manager,feedbackSent]);
  async function sendFeedback(event:React.FormEvent){
    event.preventDefault();if(busy||feedbackSent)return;setBusy(true);
    try{const {error}=await supabase.from("session_feedback").insert({session_id:id,user_id:profile!.id,speaker_rating:Number(speakerRating),content_rating:Number(contentRating),comment:comment.trim()});if(error)throw error;setFeedbackSent(true);showToast("success","Cảm ơn bạn đã đánh giá phiên");}catch{showToast("error","Không thể gửi đánh giá. Khảo sát chỉ mở sau khi phiên kết thúc.");}finally{setBusy(false);}
  }
  if(loading)return <p role="status">Đang tải phiên...</p>;
  if(error||!session)return <Card className="p-5"><p role="alert" className="text-rose-700">{error}</p><Button className="mt-4" variant="outline" onClick={()=>void load()}>Thử lại</Button></Card>;
  const ended=new Date(session.end_time).getTime()<=Date.now();
  return <div className="space-y-6"><Button variant="outline" onClick={()=>navigate("sessions")}>Quay lại lịch trình</Button><header><p className="text-sm text-teal-700">{session.conference?.title}</p><h1 className="mt-1 text-2xl font-bold">{session.title}</h1><p className="mt-2 text-sm text-slate-500">{new Date(session.start_time).toLocaleString("vi-VN")} – {new Date(session.end_time).toLocaleString("vi-VN")} · {session.room||"Chưa phân phòng"}</p>{session.speaker&&<p className="mt-3 text-sm">Diễn giả: {session.speaker.full_name} · {session.speaker.organization}</p>}{session.speaker?.bio&&<p className="mt-2 text-sm text-slate-600">{session.speaker.bio}</p>}</header>
    <section><h2 className="mb-3 text-lg font-semibold">Tài liệu phiên báo cáo</h2><ResourceCenter conferenceId={session.conference_id} sessionId={id}/></section>
    <Card className="p-5"><h2 className="font-semibold">Đánh giá riêng cho phiên</h2>{feedbackSent?<p className="mt-3 text-sm text-teal-700">Bạn đã gửi đánh giá. Cảm ơn sự đóng góp của bạn.</p>:ended&&attendance?<form className="mt-4 space-y-4" onSubmit={sendFeedback}><div className="grid gap-4 sm:grid-cols-2"><Select label="Diễn giả" value={speakerRating} onChange={(event)=>setSpeakerRating(event.target.value)}>{[5,4,3,2,1].map((rating)=><option key={rating} value={rating}>{rating} / 5</option>)}</Select><Select label="Nội dung" value={contentRating} onChange={(event)=>setContentRating(event.target.value)}>{[5,4,3,2,1].map((rating)=><option key={rating} value={rating}>{rating} / 5</option>)}</Select></div><Textarea label="Nhận xét / góp ý" maxLength={2000} value={comment} onChange={(event)=>setComment(event.target.value)} /><Button type="submit" disabled={busy}>Gửi đánh giá</Button></form>:<p className="mt-3 text-sm text-slate-500">Khảo sát mở sau khi phiên kết thúc.</p>}{manager&&summary&&<div className="mt-5 border-t border-slate-200 pt-4"><h3 className="text-sm font-semibold">Kết quả tổng hợp ({summary.responses} phản hồi)</h3><p className="mt-2 text-sm text-slate-600">Diễn giả: {summary.speaker_average??"Chưa có"} / 5 · Nội dung: {summary.content_average??"Chưa có"} / 5</p><p className="mt-1 text-xs text-slate-500">Ban tổ chức xem điểm tổng hợp; câu trả lời cá nhân được giữ riêng tư.</p></div>}</Card>
  </div>;
}
