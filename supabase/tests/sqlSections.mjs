import { readFile } from 'node:fs/promises';

export async function readSqlSection(name, bundle = 'conference_updates.sql') {
  const sql = await readFile(new URL(`../migrations/${bundle}`, import.meta.url), 'utf8');
  const start = `-- BEGIN SECTION ${name}\n`;
  const end = `-- END SECTION ${name}`;
  const normalized = sql.replace(/\r\n/g, '\n');
  const from = normalized.indexOf(start);
  const to = normalized.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Missing SQL section: ${name}`);
  return normalized.slice(from + start.length, to);
}
