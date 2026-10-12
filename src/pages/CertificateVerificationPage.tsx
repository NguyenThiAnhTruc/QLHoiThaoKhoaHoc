import {useEffect,useState} from 'react';
import {supabase} from '@/lib/supabase';
import {Card} from '@/components/ui/Card';
import {Button} from '@/components/ui/Button';
import {CERTIFICATE_TYPE_LABELS} from '@/lib/constants';
interface Result{certificate_number:string;conference_title:string;certificate_type:'attendance'|'presentation';issued_at:string;revoked_at:string|null}
export function CertificateVerificationPage({token}:{token:string}){
 const [result,setResult]=useState<Result|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let cancelled=false;setLoading(true);setError('');setResult(null);
  void (async()=>{try{
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token))throw new Error('Mã tra cứu không hợp lệ.');
   const {data,error}=await supabase.rpc('verify_certificate',{token});
   if(error)throw new Error('Không thể tra cứu lúc này. Vui lòng thử lại.');
   if(!cancelled)setResult(data?.[0] ?? null);
  }catch(error){if(!cancelled)setError(error instanceof Error?error.message:'Không thể tra cứu.');}
  finally{if(!cancelled)setLoading(false);}})();return()=>{cancelled=true;};
 },[token,retry]);
 return <main className="min-h-screen bg-slate-50 p-6"><Card className="mx-auto max-w-xl space-y-4 p-6"><h1 className="text-2xl font-bold">Tra cứu chứng nhận</h1>{loading?<p role="status">Đang kiểm tra...</p>:error?<div role="alert"><p>{error}</p><Button onClick={()=>setRetry(retry+1)}>Thử lại</Button></div>:result?<><p className={result.revoked_at?'font-semibold text-rose-700':'font-semibold text-emerald-700'}>{result.revoked_at?'Chứng nhận đã thu hồi':'Chứng nhận đang có hiệu lực'}</p><p>Số: {result.certificate_number}</p><p>{result.conference_title}</p><p>{CERTIFICATE_TYPE_LABELS[result.certificate_type]}</p><p>Ngày cấp: {new Date(result.issued_at).toLocaleDateString('vi-VN')}</p>{result.revoked_at&&<p>Ngày thu hồi: {new Date(result.revoked_at).toLocaleDateString('vi-VN')}</p>}<p className="text-sm text-slate-500">Đối chiếu số chứng nhận và hội thảo với bản bạn nhận được.</p></>:<p>Không tìm thấy chứng nhận với mã này.</p>}<a href="/" className="block text-teal-700 underline">Về trang chủ</a></Card></main>;
}
