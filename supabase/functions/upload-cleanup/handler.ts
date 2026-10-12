interface Config {url:string;key:string;secret:string}
interface Upload {bucket_id:string;file_path:string}
export function createUploadCleanupHandler(config:Config,fetcher:typeof fetch=fetch){
 return async(request:Request)=>{
  const response=(status:number,data:unknown)=>Response.json(data,{status,headers:{"Cache-Control":"no-store"}});
  if(request.method!=="POST")return response(405,{error:"POST required"});
  if(!config.secret || !config.url || !config.key)return response(503,{error:"Cleanup configuration missing"});
  if(request.headers.get("X-Job-Secret")!==config.secret)return response(401,{error:"Unauthorized"});
  const headers={apikey:config.key,Authorization:`Bearer ${config.key}`,"Content-Type":"application/json"};
  const call=(path:string,options:RequestInit)=>fetcher(`${config.url}${path}`,{...options,headers,signal:AbortSignal.timeout(15000)});
  try{
   const reserved=await call("/rest/v1/rpc/reserve_orphan_uploads",{method:"POST",body:JSON.stringify({batch_size:25})});
   if(!reserved.ok)throw new Error();
   const uploads:Upload[]=await reserved.json();let cleaned=0,failed=0;
   for(const upload of uploads){
    try{
     if(!["conference-resources","fee-proofs"].includes(upload.bucket_id))throw new Error();
     // Use Storage API so both object bytes and metadata are removed.
     const removed=await call(`/storage/v1/object/${upload.bucket_id}`,{method:"DELETE",body:JSON.stringify({prefixes:[upload.file_path]})});
     if(!removed.ok)throw new Error();
     const marked=await call(`/rest/v1/upload_cleanup_jobs?bucket_id=eq.${encodeURIComponent(upload.bucket_id)}&file_path=eq.${encodeURIComponent(upload.file_path)}`,{method:"PATCH",body:JSON.stringify({cleaned_at:new Date().toISOString()})});
     if(!marked.ok)throw new Error();
     cleaned++;
    }catch{failed++;}
   }
   return response(200,{cleaned,failed});
  }catch{return response(502,{error:"Cleanup unavailable; check migration and server configuration"});}
 };
}
