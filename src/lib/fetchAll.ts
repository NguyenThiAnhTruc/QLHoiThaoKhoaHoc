// Read every page, including when the API's configured row limit is smaller
// than the requested page size. Queries must have a stable, unique ordering.
export async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null; count: number | null;
}>) {
  const rows: T[] = [];
  while (true) {
    const result = await query(rows.length, rows.length + 499);
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
