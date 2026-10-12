export interface InsertAttempt { key: string; id: string }
export function insertAttempt(previous: InsertAttempt | null, payload: unknown): InsertAttempt {
  const key=JSON.stringify(payload);
  return previous?.key===key ? previous : {key,id:crypto.randomUUID()};
}
export async function confirmInsert(
  write:()=>PromiseLike<{error:unknown}>,
  lookup:()=>PromiseLike<{data:unknown;error:unknown}>,
) {
  let failure:unknown;
  try { const result=await write(); if(!result.error)return; failure=result.error; }
  catch(error){failure=error;}
  // A lost response is not proof that the transaction failed.
  const existing=await lookup();
  if(!existing.error && existing.data)return;
  throw failure ?? existing.error ?? new Error("Insert not confirmed");
}
