import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// This script commits fixtures. Run only against the disposable local cluster.
assert.equal(process.env.ROLE_TEST_DISPOSABLE, '1');
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGPORT, '55439');
const conf = '97000000-0000-0000-0000-000000000001';
function sql(statement, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.TEST_PSQL, ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { windowsHide: true });
    let output = '';
    child.stdout.on('data', (data) => { output += data; onOutput(output); });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', reject);
    child.on('exit', (status) => resolve({ status, output }));
    child.stdin.end(statement);
  });
}
const checked = async (statement) => { const result = await sql(statement); assert.equal(result.status, 0, result.output); return result.output.trim(); };
await checked(`INSERT INTO public.conferences(id,title,start_date,end_date,status,organizer_id,max_participants)
VALUES ('${conf}','Concurrency test',current_date,current_date,'open','00000000-0000-0000-0000-000000000002',1)`);
try {
  let release;
  const reserved = new Promise((resolve) => { release = resolve; });
  const first = sql(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000003',true);
    INSERT INTO public.participants(conference_id,user_id) VALUES ('${conf}',auth.uid());
    SELECT 'slot-reserved'; SELECT pg_sleep(1); COMMIT;`, (output) => { if (output.includes('slot-reserved')) release(); });
  await Promise.race([reserved, first.then((result) => { if (result.status !== 0) throw new Error(result.output); })]);
  const second = sql(`BEGIN; SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',true);
    INSERT INTO public.participants(conference_id,user_id) VALUES ('${conf}',auth.uid()); COMMIT;`);
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 0, a.output);
  assert.notEqual(b.status, 0, 'Second concurrent registration must fail');
  assert.equal(await checked(`SELECT count(*) FROM public.participants WHERE conference_id='${conf}'`), '1');
  assert.equal(await checked(`SELECT registered_count FROM public.conference_registration_counts WHERE conference_id='${conf}'`), '1');
  await checked(`DELETE FROM public.participants WHERE conference_id='${conf}';
    INSERT INTO public.participants(conference_id,user_id) VALUES ('${conf}','00000000-0000-0000-0000-000000000004');`);
  assert.equal(await checked(`SELECT registered_count FROM public.conference_registration_counts WHERE conference_id='${conf}'`), '1');
  console.log('PASS: concurrent last-slot registration; rejected reservation rolls back; cancellation releases slot');
} finally {
  await checked(`DELETE FROM public.conferences WHERE id='${conf}'`);
}
