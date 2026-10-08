import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Database credentials belong in the shell environment, never VITE_* or committed files.
if (!process.env.DATABASE_URL) {
  console.error('Chưa có DATABASE_URL. Cấu hình chuỗi kết nối PostgreSQL trong môi trường hoặc chạy SQL theo README.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await client.query('SELECT pg_advisory_lock(610082026)');
  const {rows}=await client.query("SELECT to_regclass('public.conferences') IS NOT NULL AS initialized");
  if(!rows[0].initialized)throw new Error('DATABASE_NOT_INITIALIZED');
  for(const filename of ['20261008_complete_workflows.sql','20261008_seminar_experience.sql']) {
    await client.query(await readFile(new URL(`../supabase/migrations/${filename}`,import.meta.url),'utf8'));
    console.log(`Đã áp dụng ${filename}`);
  }
} catch(error) {
  console.error(error.message==='DATABASE_NOT_INITIALIZED'
    ? 'Database chưa khởi tạo. Chạy initialize_production.sql và các migration nền theo README trước.'
    : `Không thể áp dụng migration. Kiểm tra kết nối và schema nền (mã ${error.code ?? 'CONNECTION_OR_SCHEMA'}).`);
  process.exitCode=1;
} finally { await client.end().catch(()=>{}); }
