import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/context/useAuth";
import { useConferenceAccess } from "@/context/useConferenceAccess";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { showToast } from "@/components/ui/toastStore";
import type { Conference, Session } from "@/types";

type Visibility="public"|"registered"|"checked_in";
interface Resource { id:string;conference_id:string;session_id:string|null;uploader_id:string;title:string;kind:string;visibility:Visibility;file_path:string;version_number:number;created_at:string; allowed?:boolean }
const visibilityLabels:Record<Visibility,string>={public:"Công khai",registered:"Đã đăng ký",checked_in:"Đã điểm danh"};
const kinds:Record<string,string>={slides:"Slide báo cáo",reading:"Tài liệu đọc thêm",proceedings:"Kỷ yếu"};
const formats:Record<string,string>={pdf:"application/pdf",ppt:"application/vnd.ms-powerpoint",pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation"};

export function ResourceCenter({ conferenceId: suppliedConference, sessionId: suppliedSession }: {conferenceId?:string;sessionId?:string}) {
  const { profile }=useAuth(); const { canManage }=useConferenceAccess();
  const generation=useRef(0);
  const [conferenceId,setConferenceId]=useState(suppliedConference ?? "");
  const [conferences,setConferences]=useState<Conference[]>([]); const [sessions,setSessions]=useState<Session[]>([]);
  const [resources,setResources]=useState<Resource[]>([]); const [loading,setLoading]=useState(false);const [error,setError]=useState("");
  const [sessionId,setSessionId]=useState(suppliedSession ?? ""); const [uploadable,setUploadable]=useState<Set<string>>(new Set());
  const [title,setTitle]=useState("");const [kind,setKind]=useState("slides");const [visibility,setVisibility]=useState<Visibility>("checked_in");const [file,setFile]=useState<File|null>(null);const [busy,setBusy]=useState(false);const [uploadKey,setUploadKey]=useState(0);
  useEffect(()=>{setConferenceId(suppliedConference ?? "");setSessionId(suppliedSession ?? "");},[suppliedConference,suppliedSession]);
  useEffect(()=>{void supabase.from("conferences").select("*").order("title").then(({data,error})=>{if(error)setError("Không thể tải hội thảo");else setConferences((data ?? []) as Conference[]);});},[]);
  const load=useCallback(async()=>{
    const request=++generation.current;
    if(!conferenceId) {setResources([]);setSessions([]);setUploadable(new Set());setLoading(false);return;}
    setLoading(true);setError("");
    try {
      let sessionQuery=supabase.from("sessions").select("*").eq("conference_id",conferenceId).order("start_time");
      if(suppliedSession)sessionQuery=sessionQuery.eq("id",suppliedSession);
      let resourceQuery=supabase.from("conference_resources").select("*").eq("conference_id",conferenceId).order("created_at",{ascending:false});
      if(suppliedSession)resourceQuery=resourceQuery.eq("session_id",suppliedSession);
      const [sessionRows,resourceRows]=await Promise.all([sessionQuery,resourceQuery]);
      if(sessionRows.error || resourceRows.error)throw new Error("Không thể tải tài liệu. Kiểm tra kết nối và bản cập nhật hệ thống.");
      const sessionData=(sessionRows.data ?? []) as Session[];
      const permissions=await Promise.all(sessionData.map(async(session)=>{const {data,error}=await supabase.rpc("can_upload_session_documents",{target_session_id:session.id});if(error)throw error;return data ? session.id:null;}));
      const checked=await Promise.all((resourceRows.data ?? []).map(async(resource)=>{const {data,error}=await supabase.rpc("can_download_resource",{target_resource_id:resource.id});if(error)throw error;return {...resource,allowed:data===true};}));
      if(request!==generation.current)return;
      setSessions(sessionData);setUploadable(new Set(permissions.filter((id):id is string=>id!==null)));setResources(checked as Resource[]);
    }catch(error){if(request===generation.current){setError(error instanceof Error ? error.message:"Không thể tải quyền truy cập tài liệu");setResources([]);}}
    finally{if(request===generation.current)setLoading(false);}
  },[conferenceId,suppliedSession]);
  useEffect(()=>{const counter=generation;void load();return()=>{counter.current++;};},[load]);
  async function upload(event:React.FormEvent){
    event.preventDefault();if(busy || !profile || !file || !title.trim())return;
    if(!canManage(conferenceId) && !uploadable.has(sessionId)){showToast("error","Không có quyền tải tài liệu hoặc đã hết hạn");return;}
    const extension=file.name.split(".").pop()?.toLowerCase() ?? "";
    if(!formats[extension] || file.size>25*1024*1024){showToast("error","Chọn PDF, PPT hoặc PPTX tối đa 25 MB");return;}
    if(kind==="slides" && !sessionId){showToast("error","Chọn phiên báo cáo cho slide");return;}
    setBusy(true);
    try{
      const path=`${profile.id}/${conferenceId}/${crypto.randomUUID()}.${extension}`;
      const uploaded=await supabase.storage.from("conference-resources").upload(path,file,{upsert:false,contentType:formats[extension]});if(uploaded.error)throw uploaded.error;
      const saved=await supabase.from("conference_resources").insert({conference_id:conferenceId,session_id:sessionId || null,uploader_id:profile.id,title:title.trim(),kind,visibility,file_path:path});if(saved.error)throw saved.error;
      showToast("success","Đã lưu phiên bản tài liệu mới");setFile(null);setTitle("");setUploadKey((value)=>value+1);await load();
    }catch{showToast("error","Không thể lưu tài liệu. Kiểm tra quyền hoặc hạn tải lên.");}finally{setBusy(false);}
  }
  async function download(resource:Resource){
    const {data,error}=await supabase.storage.from("conference-resources").createSignedUrl(resource.file_path,60,{download:true});
    if(error || !data){showToast("error","Bạn chưa đủ điều kiện tải tài liệu hoặc quyền đã thay đổi");return;}
    const link=document.createElement("a");link.href=data.signedUrl;link.target="_blank";link.rel="noopener noreferrer";link.click();
  }
  async function changeVisibility(resource:Resource,value:Visibility){
    const {error}=await supabase.from("conference_resources").update({visibility:value}).eq("id",resource.id).select("id").single();
    if(error)showToast("error","Không thể đổi quyền tài liệu");else{showToast("success","Đã cập nhật quyền tải");await load();}
  }
  return <div className="space-y-4">
    {!suppliedConference && <Select label="Hội thảo" disabled={busy} value={conferenceId} onChange={(event)=>{setConferenceId(event.target.value);setSessionId("");setResources([]);}}><option value="">Chọn hội thảo</option>{conferences.map((conference)=><option key={conference.id} value={conference.id}>{conference.title}</option>)}</Select>}
    {error && <Card className="p-4"><p role="alert" className="text-sm text-rose-700">{error}</p><Button className="mt-3" variant="outline" onClick={()=>void load()}>Thử lại</Button></Card>}
    {!error && conferenceId && (canManage(conferenceId)||uploadable.size>0) && <Card className="p-5"><h2 className="font-semibold">Tải tài liệu / phiên bản cuối</h2><p className="mt-1 text-xs text-slate-500">Mỗi lần tải lên là một phiên bản mới. Diễn giả tải trước hạn của phiên; ban tổ chức có thể cập nhật sau.</p><form onSubmit={upload} className="mt-4"><fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2"><Input label="Tên tài liệu" required value={title} onChange={(event)=>setTitle(event.target.value)} /><Select label="Loại tài liệu" value={kind} onChange={(event)=>setKind(event.target.value)}><option value="slides">Slide báo cáo</option><option value="reading">Tài liệu đọc thêm</option>{canManage(conferenceId)&&<option value="proceedings">Kỷ yếu</option>}</Select><Select label="Phiên báo cáo" value={sessionId} disabled={!!suppliedSession} onChange={(event)=>setSessionId(event.target.value)}><option value="">Tài liệu chung của hội thảo</option>{sessions.filter((session)=>canManage(conferenceId)||uploadable.has(session.id)).map((session)=><option key={session.id} value={session.id}>{session.title}</option>)}</Select><Select label="Quyền tải xuống" value={visibility} onChange={(event)=>setVisibility(event.target.value as Visibility)}>{Object.entries(visibilityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select><Input key={uploadKey} label="PDF / PowerPoint (tối đa 25 MB)" type="file" accept=".pdf,.ppt,.pptx" required onChange={(event)=>setFile(event.target.files?.[0] ?? null)} /><Button type="submit" disabled={busy}>{busy ? "Đang lưu...":"Tải lên phiên bản mới"}</Button></fieldset></form></Card>}
    {loading ? <p role="status" className="py-5 text-slate-500">Đang tải tài liệu...</p>:!error && conferenceId && <div className="space-y-3">{resources.length===0&&<Card className="p-8 text-center text-slate-500">Chưa có tài liệu được công bố.</Card>}{resources.map((resource)=><Card key={resource.id} className="flex flex-wrap items-center justify-between gap-4 p-4"><div><h3 className="font-semibold">{resource.title}</h3><p className="mt-1 text-xs text-slate-500">{kinds[resource.kind]} · Phiên bản {resource.version_number} · {visibilityLabels[resource.visibility]}</p>{!resource.allowed&&<p className="mt-2 text-sm text-amber-700">{resource.visibility==="checked_in" ? "Điểm danh hội thảo để tải tài liệu":"Đăng ký hội thảo để tải tài liệu"}</p>}</div><div className="flex items-center gap-2">{canManage(conferenceId)&&<Select aria-label={`Quyền tải ${resource.title}`} value={resource.visibility} onChange={(event)=>void changeVisibility(resource,event.target.value as Visibility)}>{Object.entries(visibilityLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</Select>}<Button size="sm" disabled={!resource.allowed} onClick={()=>void download(resource)}>Tải xuống</Button></div></Card>)}</div>}
  </div>;
}
