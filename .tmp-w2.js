const cfg=require('./config.json');const fs=require('fs');const {Client}=require('pg');
let url=fs.readFileSync(cfg.db.envFile,'utf8').match(/^DATABASE_URL=(.+)$/m)[1].trim().replace(/^"|"$/g,'');
if(url.includes('sslmode=')&&!url.includes('uselibpqcompat='))url=url.replace('sslmode=','uselibpqcompat=true&sslmode=');
const q=async()=>{const c=new Client({connectionString:url});await c.connect();
 const r=await c.query(`SELECT to_char(created_at,'MM-DD HH24:MI') t, body_text FROM public.agent_feed
   WHERE title LIKE 'Cron failure: graph-report-imports%' ORDER BY created_at DESC LIMIT 1`);
 const v=await c.query(`SELECT to_char(created_at,'MM-DD HH24:MI') t, body_text FROM public.agent_feed
   WHERE title LIKE 'Report import stale%' ORDER BY created_at DESC LIMIT 1`);
 await c.end();return {fail:r.rows[0],stale:v.rows[0]};};
(async()=>{
 const b=await q();
 console.log('BEFORE — last cron failure:', b.fail?b.fail.t:'(none)');
 const target=new Date(Date.UTC(2026,7,31,12,17,0));
 const ms=target-new Date();
 if(ms>0)await new Promise(r=>setTimeout(r,ms));
 const a=await q();
 console.log('AFTER 12:15 run — last cron failure:', a.fail?a.fail.t:'(none)');
 if(a.fail&&b.fail&&a.fail.t===b.fail.t){
   console.log('\n*** FIXED — the 12:15 run produced no new failure. ***');
 } else {
   console.log('\n*** STILL FAILING at',a.fail.t,'***');
   console.log((a.fail.body_text||'').slice(0,400));
 }
 console.log('\nlatest staleness warning:', a.stale?a.stale.t:'(none)');
 const m=(a.stale?.body_text||'').match(/last imported (\d+)h ago/);
 if(m)console.log('vacancy report still',m[1],'h stale');
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
