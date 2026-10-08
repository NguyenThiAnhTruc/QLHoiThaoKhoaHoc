import type { Session } from "@/types";

export interface AgendaSlot { session: Session; start: number; end: number; lane: number; lanes: number; room: string }
const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
export function buildAgendaLayout(sessions: Session[]) {
  const days = new Map<string, AgendaSlot[]>();
  for (const session of sessions) {
    const start = new Date(session.start_time), end = new Date(session.end_time);
    if (!Number.isFinite(+start) || !Number.isFinite(+end) || end <= start) continue;
    for (let cursor = new Date(start.getFullYear(),start.getMonth(),start.getDate()); cursor < end; cursor.setDate(cursor.getDate()+1)) {
      const next = new Date(cursor.getFullYear(),cursor.getMonth(),cursor.getDate()+1);
      const a = new Date(Math.max(+start,+cursor)), b = new Date(Math.min(+end,+next));
      if (+a === +b) continue;
      const key = dateKey(cursor);
      const slots = days.get(key) ?? [];
      slots.push({session,start:a.getHours()*60+a.getMinutes(),end:+b===+next ? 1440 : b.getHours()*60+b.getMinutes(),lane:0,lanes:1,room:session.room?.trim() || session.committee?.room?.trim() || "Chưa phân phòng"});
      days.set(key,slots);
    }
  }
  return [...days.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,slots])=>{
    const rooms=[...new Set(slots.map((slot)=>slot.room))].sort((a,b)=>a.localeCompare(b,"vi"));
    for(const room of rooms) {
      const laneEnds:number[]=[];
      const entries=slots.filter((slot)=>slot.room===room).sort((a,b)=>a.start-b.start || a.end-b.end);
      for(const slot of entries) {
        let lane=laneEnds.findIndex((end)=>end<=slot.start);
        if(lane<0) lane=laneEnds.length;
        laneEnds[lane]=slot.end; slot.lane=lane;
      }
      entries.forEach((slot)=>{slot.lanes=laneEnds.length;});
    }
    return {date,rooms,slots,start:Math.floor(Math.min(...slots.map((s)=>s.start))/30)*30,end:Math.ceil(Math.max(...slots.map((s)=>s.end))/30)*30};
  });
}
export const minuteLabel=(minute:number)=>`${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`;
