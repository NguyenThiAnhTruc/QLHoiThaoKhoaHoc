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
  return <div className="space-y-6">
    <header>
      <p className="text-sm font-medium text-teal-700">Khu vực diễn giả</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">Các phiên báo cáo của tôi</h1>
      <p className="mt-1 text-sm text-slate-500">Theo dõi lịch, hạn tải tài liệu và chuẩn bị nội dung báo cáo.</p>
    </header>
    <Card className="flex flex-wrap items-center justify-between gap-4 border-l-4 border-l-teal-600 p-5">
      <div className="flex items-center gap-4">
        {profile?.avatar_url&&<img src={profile.avatar_url} alt="" className="h-14 w-14 rounded-full object-cover" />}
        <div><h2 className="font-semibold text-slate-900">{profile?.full_name}</h2><p className="mt-1 text-sm text-slate-500">{profile?.bio||"Bổ sung tiểu sử ngắn để giới thiệu khi báo cáo."}</p></div>
      </div>
      <Button variant="outline" onClick={()=>navigate("profile")}>Cập nhật tiểu sử và ảnh</Button>
    </Card>
    {loading?<p role="status">Đang tải lịch báo cáo...</p>:error?<p role="alert" className="text-rose-700">{error}</p>:sessions.length===0?<Card className="p-8 text-center text-slate-500">Chưa có bài được phân lịch báo cáo. Lịch sẽ xuất hiện khi ban tổ chức phân phiên.</Card>:<div className="grid gap-5 md:grid-cols-2">{sessions.map((session)=>{
      const deadline=new Date(session.resource_deadline||session.start_time);
      const expired=deadline.getTime()<=Date.now();
      return <Card key={session.id} className="overflow-hidden border-t-4 border-t-teal-600 p-0">
        <div className="p-5">
          <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">{session.conference?.title}</p><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${expired?"bg-slate-100 text-slate-600":"bg-amber-100 text-amber-800"}`}>{expired?"Đã hết hạn tải":"Đang nhận tài liệu"}</span></div>
          <h2 className="mt-3 text-lg font-bold text-slate-900">{session.title}</h2>
          {session.paper&&<p className="mt-2 text-sm text-slate-600"><span className="font-medium">Bài báo:</span> {session.paper.title}</p>}
          <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            <p><span className="font-medium text-slate-800">Thời gian:</span> {new Date(session.start_time).toLocaleString("vi-VN")} – {new Date(session.end_time).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"})}</p>
            <p><span className="font-medium text-slate-800">Phòng:</span> {session.room||"Chưa phân phòng"}</p>
            <p><span className="font-medium text-slate-800">Hạn tải tài liệu:</span> {deadline.toLocaleString("vi-VN")}</p>
          </div>
          <Button className="mt-4 w-full" onClick={()=>navigate("session-detail",{id:session.id})}>Xem phiên và tải tài liệu</Button>
        </div>
      </Card>;
    })}</div>}
  </div>;
}
