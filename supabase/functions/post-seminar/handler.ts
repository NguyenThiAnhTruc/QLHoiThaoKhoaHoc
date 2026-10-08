import { createCertificatePdf } from "./certificatePdf.ts";

interface Config { url:string; key:string; secret:string; appUrl:string; clientId:string; clientSecret:string; refreshToken:string; sender:string }
interface Job { id:string;conference_id:string;user_id:string;certificate_id:string|null;session_id:string|null;kind:"certificate"|"survey";attempts:number }
const email=/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const encoder=new TextEncoder();
function base64(bytes:Uint8Array){let binary="";for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
function json(status:number,data:unknown){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});}
function encoded(value:string){return base64(encoder.encode(value));}
function folded(value:string){return value.match(/.{1,76}/g)?.join("\r\n") ?? "";}

export function createPostSeminarHandler(config:Config, readFont:()=>Promise<Uint8Array>, fetcher:typeof fetch=fetch) {
  return async(request:Request)=>{
    if(request.method!=="POST")return json(405,{error:"POST required"});
    if(!config.secret)return json(503,{error:"Automation secrets missing"});
    if(request.headers.get("X-Job-Secret")!==config.secret)return json(401,{error:"Unauthorized"});
    if(Object.values(config).some((value)=>!value) || !email.test(config.sender))return json(503,{error:"Automation configuration missing"});
    let app:URL;
    try{app=new URL(config.appUrl);if(app.protocol!=="https:" && !(app.protocol==="http:" && ["localhost","127.0.0.1"].includes(app.hostname)))throw new Error();}catch{return json(503,{error:"APP_URL must be HTTPS"});}
    const headers={apikey:config.key,Authorization:`Bearer ${config.key}`,"Content-Type":"application/json"};
    async function api(path:string,options:RequestInit={}) {
      const response=await fetcher(`${config.url}/rest/v1/${path}`,{...options,headers:{...headers,...options.headers}});
      if(!response.ok)throw new Error(`Database request failed (${response.status})`);
      return response.status===204 ? null:response.json();
    }
    async function row(table:string,id:string,fields:string){const rows=await api(`${table}?id=eq.${encodeURIComponent(id)}&select=${fields}`);if(!rows[0])throw new Error("Recipient or event missing");return rows[0];}
    try {
      // Authenticate mail provider before claiming work so configuration errors don't consume retries.
      const tokenResponse=await fetcher("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:config.refreshToken,grant_type:"refresh_token"})});
      const token=await tokenResponse.json();if(!tokenResponse.ok || !token.access_token)return json(502,{error:"Gmail authorization failed"});
      await api("rpc/enqueue_post_seminar_jobs",{method:"POST",body:"{}"});
      const jobs:Job[]=await api("rpc/claim_post_seminar_jobs",{method:"POST",body:JSON.stringify({batch_size:5})});
      let sent=0,failed=0;
      for(const job of jobs){
        const filter=`post_seminar_jobs?id=eq.${job.id}&status=eq.processing&attempts=eq.${job.attempts}`;
        try {
          const user=await row("profiles",job.user_id,"full_name,organization,contact_email");
          const conference=await row("conferences",job.conference_id,"title,location,start_date,end_date,status,auto_certificates,auto_surveys");
          if(conference.status==="cancelled" || !(job.kind==="certificate" ? conference.auto_certificates:conference.auto_surveys))throw new Error("Automation disabled for event");
          if(!email.test(user.contact_email))throw new Error("Recipient email invalid");
          let subject:string,body:string,pdf:Uint8Array|undefined;
          if(job.kind==="certificate"){
            const cert=await row("certificates",job.certificate_id!,"id,certificate_number,issued_at,attendance_minutes");
            pdf=await createCertificatePdf({name:user.full_name,organization:user.organization,title:conference.title,location:conference.location,number:cert.certificate_number,start:conference.start_date,end:conference.end_date,issued:cert.issued_at,minutes:cert.attendance_minutes},await readFont());
            const path=`${job.user_id}/${cert.id}.pdf`;
            const upload=await fetcher(`${config.url}/storage/v1/object/certificate-pdfs/${path}`,{method:"POST",headers:{apikey:config.key,Authorization:`Bearer ${config.key}`,"Content-Type":"application/pdf","x-upsert":"true"},body:pdf as BodyInit});
            if(!upload.ok)throw new Error(`PDF storage failed (${upload.status})`);
            await api(`certificates?id=eq.${cert.id}`,{method:"PATCH",body:JSON.stringify({pdf_path:path})});
            subject=`Giấy chứng nhận tham dự – ${conference.title}`;body=`Kính gửi ${user.full_name},\n\nBan tổ chức gửi giấy chứng nhận tham dự ${conference.title} trong tệp PDF đính kèm.\n\nTrân trọng,\nBan tổ chức`;
          }else{
            const session=await row("sessions",job.session_id!,"title");
            const target=new URL(app);target.searchParams.set("session",job.session_id!);
            subject=`Đánh giá phiên – ${session.title}`;body=`Kính gửi ${user.full_name},\n\nMời bạn đánh giá phiên ${session.title} thuộc ${conference.title}:\n${target.href}\n\nVui lòng đăng nhập tài khoản đã điểm danh.\nBan tổ chức`;
          }
          const boundary=`seminar_${job.id}`;
          const mime=[`From: ${config.sender}`,`To: ${user.contact_email}`,`Subject: =?UTF-8?B?${encoded(subject)}?=`,"MIME-Version: 1.0",`Content-Type: multipart/mixed; boundary="${boundary}"`,"",`--${boundary}`,"Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",folded(encoded(body))];
          if(pdf)mime.push(`--${boundary}`,"Content-Type: application/pdf; name=\"certificate.pdf\"","Content-Disposition: attachment; filename=\"certificate.pdf\"","Content-Transfer-Encoding: base64","",folded(base64(pdf)));
          mime.push(`--${boundary}--`,"");
          const delivered=await fetcher("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:`Bearer ${token.access_token}`,"Content-Type":"application/json"},body:JSON.stringify({raw:encoded(mime.join("\r\n")).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"")})});
          if(!delivered.ok)throw new Error(`Gmail delivery failed (${delivered.status})`);
          await api(filter,{method:"PATCH",body:JSON.stringify({status:"sent",sent_at:new Date().toISOString(),last_error:""})});sent++;
        }catch(error){
          failed++;
          // Never persist provider responses, tokens, or arbitrary network error text.
          const message=error instanceof Error && /^(Database request|Recipient|Automation disabled|PDF storage|Gmail delivery)/.test(error.message)?error.message:"Processing failed; check function configuration";
          await api(filter,{method:"PATCH",body:JSON.stringify({status:"failed",last_error:message})});
        }
      }
      return json(200,{sent,failed});
    }catch{return json(502,{error:"Automation processing failed; check server configuration"});}
  };
}
