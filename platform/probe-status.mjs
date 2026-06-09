import "dotenv/config";
const SB = process.env.SUPABASE_URL.replace(/\/+$/, "");
const K = process.env.SUPABASE_SERVICE_KEY;
const h = { apikey: K, authorization: `Bearer ${K}` };
async function q(p) { return (await fetch(`${SB}/rest/v1/${p}`, { headers: h })).json(); }
console.log("=== bot_status.v1_soak_start ===");
console.log(JSON.stringify(await q(`bot_status?key=eq.v1_soak_start&select=*`), null, 2));
console.log("\n=== bot_status all keys ===");
console.log(JSON.stringify(await q(`bot_status?select=key,updated_at,value`), null, 2).slice(0, 1000));
