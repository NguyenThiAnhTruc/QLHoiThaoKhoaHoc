import {readFile,writeFile} from 'node:fs/promises';
const files=['conference_updates.sql','20260927_paper_status_consistency.sql','20260927_disable_blind_review.sql','20261008_complete_workflows.sql','20261008_seminar_experience.sql','20261009_certificate_consistency.sql','20261010_email_delivery_safety.sql','20261010_orphan_upload_cleanup.sql','20261011_certificate_verification.sql','20261011_review_revision.sql','20261011_audit_integrity.sql','20261105_fee_payment_integrity.sql','20261105_session_roles_and_types.sql'];
const parts=await Promise.all(files.map(async name=>'\n-- SOURCE: '+name+'\n'+(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8')).replace(/^\s*(BEGIN|COMMIT);\s*$/gm,'')));
const sql='-- Upgrade existing ConfManager database. No initializer or demo data.\n-- Generated from versioned migrations; run the whole file in Supabase SQL Editor.\nBEGIN;\n'+parts.join('\n')+"\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n";
await writeFile(new URL('../supabase/migrations/upgrade_existing_database.sql',import.meta.url),sql);
const latest=parts.filter(part=>/-- SOURCE: 20261011_(certificate_verification|review_revision|audit_integrity)\.sql/.test(part));
await writeFile(new URL('../supabase/migrations/20261011_local_improvements.sql',import.meta.url),'-- Apply after the 20261010 upgrade. Existing records are retained.\nBEGIN;\n'+latest.join('\n')+"\nNOTIFY pgrst, 'reload schema';\nCOMMIT;\n");
console.log('Built upgrade_existing_database.sql');
