import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readSqlSection } from './sqlSections.mjs';

test('conference catalog shares metadata while retaining detail access and draft privacy', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  await db.exec(await read('./local_bootstrap.sql'));
  await db.exec("CREATE FUNCTION gen_salt(text) RETURNS text LANGUAGE sql AS $$ SELECT 'test'::text $$; CREATE FUNCTION crypt(text,text) RETURNS text LANGUAGE sql AS $$ SELECT 'test'::text $$;");
  await db.exec((await read('../migrations/conference_management_supabase.sql')).replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;', ''));
  await db.exec(await readSqlSection('20260927_conference_paper_catalog'));
  const conf = '10000000-0000-0000-0000-000000000001';
  for (const [account, expectedOpen] of [[1, 2], [2, 2], [3, 2], [4, 2], [5, 1]]) {
    await db.exec(`SET request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000${account}'; SET ROLE authenticated;`);
    const rows = (await db.query('SELECT * FROM public.conference_paper_catalog($1)', [conf])).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.can_open).length, expectedOpen);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['abstract', 'can_open', 'created_at', 'id', 'status', 'title']);
    await db.exec('RESET ROLE');
  }
  await db.exec("SET request.jwt.claim.sub = ''; UPDATE conferences SET status = 'draft' WHERE id = '10000000-0000-0000-0000-000000000001';");
  assert.equal((await db.query('SELECT * FROM public.conference_paper_catalog($1)', [conf])).rows.length, 0);
  await db.exec("SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000005'; SET ROLE authenticated;");
  assert.equal((await db.query('SELECT * FROM public.conference_paper_catalog($1)', [conf])).rows.length, 0);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(db.query('SELECT * FROM public.conference_paper_catalog($1)', [conf]), /permission denied/);
});
