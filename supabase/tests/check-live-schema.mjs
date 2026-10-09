// Read-only schema check. Prints presence/errors only, never configuration values.
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
const source = await readFile(new URL('../../.env', import.meta.url), 'utf8');
const variables = Object.fromEntries(source.split(/\r?\n/).filter((line) => /^[A-Z_]+=/.test(line)).map((line) => {
  const index = line.indexOf('=');
  return [line.slice(0,index), line.slice(index+1).trim().replace(/^['"]|['"]$/g,'')];
}));
const client=createClient(variables.VITE_SUPABASE_URL,variables.VITE_SUPABASE_ANON_KEY,{auth:{persistSession:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}});
const results = await Promise.all([
  client.from('conferences').select('review_enabled,require_accepted_paper').limit(1),
  client.from('papers').select('problem_statement,objectives,author_group,corresponding_author_id,author_participation_status').limit(1),
  client.from('sessions').select('parent_session_id,tags,difficulty,resource_deadline').limit(1),
  client.from('conference_resources').select('id').limit(1),
  client.from('session_feedback').select('session_id').limit(1),
  client.from('certificates').select('attendance_minutes,pdf_path').limit(1),
]);
for(let i=0;i<results.length;i++) {
  const error=results[i].error;
  process.stdout.write(`${['Conference configuration','Paper metadata','Parallel sessions','Resource center','Session feedback','Certificate PDF'][i]}: ${error ? `${error.code ?? 'NETWORK'} ${error.message}` : 'schema available'}\n`);
}
