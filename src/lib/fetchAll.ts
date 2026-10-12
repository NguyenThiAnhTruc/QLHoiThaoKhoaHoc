// Read every page, including when the API's configured row limit is smaller
// than the requested page size. Queries must have a stable, unique ordering.
export async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null; count: number | null;
}>) {
  const rows: T[] = [];
  while (true) {
    let result;
    try { result = await query(rows.length, rows.length + 499); }
    catch { return {data:null,error:{message:'Không thể tải dữ liệu. Kiểm tra kết nối và thử lại.'}}; }
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (result.count !== null && rows.length >= result.count) break;
    if (page.length === 0) {
      if (result.count !== null && rows.length < result.count) {
        return { data: null, error: { message: 'Dữ liệu đã thay đổi trong lúc tải. Vui lòng thử lại.' } };
      }
      break;
    }
  }
  return { data: rows, error: null };
}

// Keep IN filters small enough for HTTP URLs, while respecting API row caps.
export async function fetchByIds<T>(ids: string[],query:(ids:string[],from:number,to:number)=>PromiseLike<{data:T[]|null;error:{message:string}|null;count:number|null}>){
  const unique=[...new Set(ids)],rows:T[]=[];
  for(let start=0;start<unique.length;start+=100){
    const batch=unique.slice(start,start+100);
    const result=await fetchAll((from,to)=>query(batch,from,to));
    if(result.error)return {data:null,error:result.error};
    rows.push(...(result.data ?? []));
  }
  return {data:rows,error:null};
}
