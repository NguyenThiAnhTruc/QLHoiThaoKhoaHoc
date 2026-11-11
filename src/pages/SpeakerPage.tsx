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
      const [authored,owned]=await Promise.all([
        supabase.from("paper_authors").select("paper_id").eq("user_id",profile.id),
        supabase.from("papers").select("id").eq("submitted_by",profile.id),
      ]);
      if(authored.error) throw new Error(`Không thể tải bài báo đồng tác giả: ${authored.error.message}`);
      if(owned.error) throw new Error(`Không thể tải bài báo đã gửi: ${owned.error.message}`);
      const paperIds=[...(authored.data??[]).map((row)=>row.paper_id),...(owned.data??[]).map((row)=>row.id)];
      const queries=[
        supabase.from("sessions").select("*,conference:conferences(*)").eq("speaker_id",profile.id),
        ...(paperIds.length
          ? [supabase.from("sessions").select("*,conference:conferences(*)").in("paper_id",paperIds)]
          : []),
      ];
      const results=await Promise.all(queries);
      const failed=results.find((result)=>result.error);
      if(failed?.error) throw new Error(`Không thể tải các phiên báo cáo: ${failed.error.message}`);
      const unique=new Map<string, Session>();
      for(const result of results) for(const session of (result.data??[]) as Session[]) unique.set(session.id,session);
      const rows=[...unique.values()];
      const assignedPaperIds=[...new Set(rows.map((session)=>session.paper_id).filter((id): id is string => Boolean(id)))];
      if (assignedPaperIds.length) {
        const papersResult=await supabase.from("papers").select("*").in("id",assignedPaperIds);
        if (papersResult.error) throw new Error(`Không thể tải thông tin bài báo: ${papersResult.error.message}`);
        const papersById=new Map((papersResult.data??[]).map((paper)=>[paper.id,paper]));
        for (const session of rows) session.paper=papersById.get(session.paper_id ?? "");
      }
      if(!cancelled)setSessions(rows.sort((left,right)=>new Date(left.start_time).getTime()-new Date(right.start_time).getTime()));
    }catch(error){if(!cancelled)setError(error instanceof Error?error.message:"Không thể tải báo cáo");}finally{if(!cancelled)setLoading(false);}
  })();return()=>{cancelled=true;};},[profile?.id]);
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold">Báo cáo của tôi</h1><p className="mt-1 text-sm text-slate-500">Chuẩn bị hồ sơ diễn giả và tài liệu cho phiên đã được phân công.</p></header><Card className="flex flex-wrap items-center justify-between gap-4 p-5"><div className="flex items-center gap-4">{profile?.avatar_url&&<img src={profile.avatar_url} alt="" className="h-16 w-16 rounded-full object-cover" />}<div><h2 className="font-semibold">{profile?.full_name}</h2><p className="mt-1 text-sm text-slate-500">{profile?.bio||"Bổ sung tiểu sử ngắn để giới thiệu khi báo cáo."}</p></div></div><Button variant="outline" onClick={()=>navigate("profile")}>Cập nhật tiểu sử và ảnh</Button></Card>{loading?<p role="status">Đang tải lịch báo cáo...</p>:error?<p role="alert" className="text-rose-700">{error}</p>:sessions.length===0?<Card className="p-8 text-center text-slate-500">Chưa có bài được phân lịch báo cáo. Lịch sẽ xuất hiện khi ban tổ chức phân phiên.</Card>:<div className="grid gap-4 md:grid-cols-2">{sessions.map((session)=><Card key={session.id} className="border-t-4 border-t-teal-600 p-5"><p className="text-xs font-medium text-teal-700">{session.conference?.title}</p><h2 className="mt-2 text-lg font-semibold">{session.title}</h2>{session.paper&&<p className="mt-2 text-sm">Đề tài: {session.paper.title}</p>}<p className="mt-3 text-sm text-slate-500">{new Date(session.start_time).toLocaleString("vi-VN")} · {session.room||"Chưa phân phòng"}</p><p className="mt-1 text-sm text-slate-500">Hạn tải slide: {new Date(session.resource_deadline||session.start_time).toLocaleString("vi-VN")}</p><Button className="mt-4" onClick={()=>navigate("session-detail",{id:session.id})}>Chuẩn bị tài liệu và xem phiên</Button></Card>)}</div>}</div>;
}
