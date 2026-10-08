import { readSqlSection } from './sqlSections.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { PGlite } from '@electric-sql/pglite';

test('classify all 10 seed conferences without changing other conference data', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const migration = await readSqlSection('20260926_conference_field_backfill');
  const catalogSource = await readFile(new URL('../../src/lib/conferenceFields.ts', import.meta.url), 'utf8');
  const catalog = {};
  new Function('exports', ts.transpile(catalogSource, { module: ts.ModuleKind.CommonJS }))(catalog);
  const ids = [...migration.matchAll(/'([0-9a-f-]{36})'::uuid/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, 10);
  await db.exec("CREATE TABLE conferences (id uuid PRIMARY KEY, topics text[] DEFAULT ARRAY['Legacy'], start_date date DEFAULT '2026-09-26', status text DEFAULT 'open', updated_at timestamptz DEFAULT '2026-09-26T00:00:00Z');");
  for (const id of [...ids, 'ffffffff-ffff-ffff-ffff-ffffffffffff']) {
    await db.query('INSERT INTO conferences (id) VALUES ($1)', [id]);
  }
  const before = (await db.query('SELECT id, start_date, status, updated_at FROM conferences ORDER BY id')).rows;
  await db.exec(migration);
  const first = (await db.query('SELECT * FROM conferences ORDER BY id')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query('SELECT * FROM conferences ORDER BY id')).rows, first);
  assert.deepEqual((await db.query('SELECT id, start_date, status, updated_at FROM conferences ORDER BY id')).rows, before);
  const counts = {};
  for (const row of first.filter((row) => ids.includes(row.id))) {
    assert.ok(catalog.isConferenceField(row.field));
    assert.ok(row.topics.length > 0);
    assert.ok(row.topics.every((topic) => catalog.getConferenceTopics(row.field).includes(topic)));
    counts[row.field] = (counts[row.field] ?? 0) + 1;
  }
  assert.deepEqual(counts, { 'Công nghệ thông tin': 8, 'Giáo dục': 1, 'Kỹ thuật': 1 });
  const untouched = first.find((row) => !ids.includes(row.id));
  assert.equal(untouched.field, null);
  assert.deepEqual(untouched.topics, ['Legacy']);
  await assert.rejects(db.query('UPDATE conferences SET field=$1 WHERE id=$2', ['invalid', ids[0]]));
});
