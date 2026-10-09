import { useEffect,useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useRouter } from "@/context/useRouter";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type {Session} from "@/types";

export function SpeakerPage(){
  const {profile}=useAuth();const {navigate}=useRouter();const [sessions,setSessions]=useState<Session[]>([]);const [loading,setLoading]=useState(true);const [error,setError]=useState("");
  useEffect(()=>{let cancelled=false;void(async()=>{
    try{
      if(!profile?.id)return;
      const [authored,owned,scheduled]=await Promise.all([supabase.from("paper_authors").select("paper_id").eq("user_id",profile.id),supabase.from("papers").select("id").eq("submitted_by",profile.id),supabase.from("sessions").select("*,conference:conferences(*),paper:papers(*)").order("start_time")]);
      if(authored.error||owned.error||scheduled.error)throw new Error("Không thể tải các phiên báo cáo của bạn");
      const ids=new Set([...(authored.data??[]).map((row)=>row.paper_id),...(owned.data??[]).map((row)=>row.id)]);
      if(!cancelled)setSessions(((scheduled.data??[]) as Session[]).filter((session)=>session.speaker_id===profile.id||(session.paper_id&&ids.has(session.paper_id))));
    }catch(error){if(!cancelled)setError(error instanceof Error?error.message:"Không thể tải báo cáo");}finally{if(!cancelled)setLoading(false);}
  })();return()=>{cancelled=true;};},[profile?.id]);
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold">Báo cáo của tôi</h1><p className="mt-1 text-sm text-slate-500">Chuẩn bị hồ sơ diễn giả và tài liệu cho phiên đã được phân công.</p></header><Card className="flex flex-wrap items-center justify-between gap-4 p-5"><div className="flex items-center gap-4">{profile?.avatar_url&&<img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />}<div><h2 className="font-semibold">{profile?.full_name}</h2><p className="mt-1 text-sm text-slate-500">{profile?.bio||"Bổ sung tiểu sử ngắn để giới thiệu khi báo cáo."}</p></div></div><Button variant="outline" onClick={()=>navigate("profile")}>Cập nhật tiểu sử và ảnh</Button></Card>{loading?<p role="status">Đang tải lịch báo cáo...</p>:error?<p role="alert" className="text-rose-700">{error}</p>:sessions.length===0?<Card className="p-8 text-center text-slate-500">Chưa có bài được phân lịch báo cáo. Lịch sẽ xuất hiện khi ban tổ chức phân phiên.</Card>:<div className="grid gap-4 md:grid-cols-2">{sessions.map((session)=><Card key={session.id} className="border-t-4 border-t-teal-600 p-5"><p className="text-xs font-medium text-teal-700">{session.conference?.title}</p><h2 className="mt-2 text-lg font-semibold">{session.title}</h2>{session.paper&&<p className="mt-2 text-sm">Đề tài: {session.paper.title}</p>}<p className="mt-3 text-sm text-slate-500">{new Date(session.start_time).toLocaleString("vi-VN")} · {session.room||"Chưa phân phòng"}</p><p className="mt-1 text-sm text-slate-500">Hạn tải slide: {new Date(session.resource_deadline||session.start_time).toLocaleString("vi-VN")}</p><Button className="mt-4" onClick={()=>navigate("session-detail",{id:session.id})}>Chuẩn bị tài liệu và xem phiên</Button></Card>)}</div>}</div>;
}
