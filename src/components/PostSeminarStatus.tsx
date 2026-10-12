import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

interface Job {id:string;kind:string;status:string;attempts:number;last_error:string}
export function PostSeminarStatus({conferenceId}:{conferenceId:string}) {
  const [jobs,setJobs]=useState<Job[]>([]);const [error,setError]=useState(false);const [loading,setLoading]=useState(false);
  const generation=useRef(0);
  const load=useCallback(async()=>{
    const request=++generation.current;
    setLoading(true);
    setError(false);setJobs([]);
    try {
      const result=await supabase.from("post_seminar_jobs").select("id,kind,status,attempts,last_error").eq("conference_id",conferenceId).order("created_at",{ascending:false}).limit(100);
      if(request!==generation.current)return;
      setError(Boolean(result.error));setJobs(result.data ?? []);
    }catch{if(request===generation.current)setError(true);}
    finally{if(request===generation.current)setLoading(false);}
  },[conferenceId]);
  useEffect(()=>{const counter=generation;void load();return()=>{counter.current++;};},[load]);
  return <Card className="p-4"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Email sau hội thảo</h2><Button size="sm" variant="outline" disabled={loading} onClick={()=>void load()}>Làm mới</Button></div>{loading?<p role="status" className="mt-2 text-sm text-slate-500">Đang tải trạng thái email...</p>:error?<p className="mt-2 text-sm text-amber-700">Chưa tải được trạng thái tác vụ. Kiểm tra migration và kết nối.</p>:<><p className="mt-2 text-sm text-slate-500">100 tác vụ gần nhất · Đã gửi {jobs.filter(j=>j.status==="sent").length} · Đang chờ {jobs.filter(j=>["pending","processing"].includes(j.status)).length} · Cần đối chiếu {jobs.filter(j=>j.status==="uncertain").length} · Lỗi {jobs.filter(j=>j.status==="failed").length}</p>{jobs.filter(j=>["failed","uncertain"].includes(j.status)).slice(0,5).map(job=><p key={job.id} className="mt-2 text-sm text-rose-700">{job.kind==="certificate"?"Chứng nhận":"Khảo sát"} · Lần thử {job.attempts}/5 · {job.status==="uncertain"?"Chưa xác định kết quả gửi. Kiểm tra thư đã gửi trong Gmail trước khi gửi lại.":job.last_error}</p>)}</>}</Card>;
}
