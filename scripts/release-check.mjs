import {spawn} from 'node:child_process';
import {readdir} from 'node:fs/promises';
const tests=(await readdir('supabase/tests')).filter(name=>name.endsWith('.test.mjs')).map(name=>'supabase/tests/'+name);
const steps=[['TypeScript',['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.app.json']],['ESLint',['node_modules/eslint/bin/eslint.js','.','--max-warnings=0']],['Business tests',['--test',...tests]],['Production build',['node_modules/vite/bin/vite.js','build']],['Preview HTTP',['supabase/tests/preview-smoke.mjs']]];
if(process.argv.includes('--live'))steps.push(['Live Supabase schema',['supabase/tests/check-live-schema.mjs']]);
for(const [label,args] of steps){
 console.log('Checking '+label);
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{stdio:'inherit',windowsHide:true});child.once('error',reject);child.once('exit',resolve);});
 if(code!==0){console.error(label+' failed; deployment is not ready.');process.exit(code || 1);}
}
console.log('Local checks passed. Live deployment still requires migrations, Edge Functions and configuration.');
