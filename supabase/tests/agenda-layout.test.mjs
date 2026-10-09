import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
const result=await build({entryPoints:[fileURLToPath(new URL('../../src/lib/agendaLayout.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'});
const {buildAgendaLayout}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
test('parallel room slots preserve duration and place overlaps in separate lanes',()=>{
  const base={conference_id:'c',room:'A',start_time:'2026-01-01T09:00:00',end_time:'2026-01-01T10:00:00'};
  const [day]=buildAgendaLayout([{...base,id:'one'},{...base,id:'two',start_time:'2026-01-01T09:30:00'},{...base,id:'three',room:'B'}]);
  assert.equal(day.slots.length,3);assert.equal(day.slots.find((s)=>s.session.id==='one').lanes,2);assert.notEqual(day.slots[0].lane,day.slots[1].lane);assert.equal(day.slots[0].end-day.slots[0].start,60);
});
test('overnight sessions split at local midnight without making an empty next day',()=>{
  const days=buildAgendaLayout([{id:'overnight',room:'A',start_time:'2026-01-01T23:30:00',end_time:'2026-01-02T00:30:00'}]);
  assert.equal(days.length,2);assert.equal(days[0].slots[0].end,1440);assert.equal(days[1].slots[0].start,0);
  assert.equal(buildAgendaLayout([{id:'midnight',room:'A',start_time:'2026-01-01T23:30:00',end_time:'2026-01-02T00:00:00'}]).length,1);
});
