import {Button} from './Button';
export function Pagination({page,totalPages,total,onChange}:{page:number;totalPages:number;total:number;onChange:(page:number)=>void}){
  if(total===0)return null;
  return <nav aria-label="Phân trang" className="flex flex-wrap items-center justify-between gap-3 py-3"><p aria-live="polite" className="text-sm text-slate-500">{total} kết quả · Trang {page}/{totalPages}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page<=1} onClick={()=>onChange(page-1)}>Trước</Button><Button size="sm" variant="outline" disabled={page>=totalPages} onClick={()=>onChange(page+1)}>Sau</Button></div></nav>;
}
