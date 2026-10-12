export function listPage<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  const size=Math.max(1,Math.trunc(pageSize) || 1);
  const totalPages=Math.max(1,Math.ceil(items.length/size));
  const page=Math.min(totalPages,Math.max(1,Math.trunc(requestedPage) || 1));
  return {page,totalPages,total:items.length,items:items.slice((page-1)*size,page*size)};
}
export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().trim();
}
