import crypto from "node:crypto";
const SECRET="f898bfcb361e9fc65b46399daa128ae2";
const SVC="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0dmhxdWRvbnZ2c3p1cHpoY2ZsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTUzNzg3OCwiZXhwIjoyMDk1MTEzODc4fQ.a6m6iwh9favoUlgi1BajeIGkMfPfbvDyH-cxFSyE0dM";
const SUPA="https://ptvhqudonvvszupzhcfl.supabase.co", FROM="971501168462", WEBHOOK="https://command.nisria.co/api/whatsapp/webhook";
const T=[{text:"Send a WhatsApp message to Violet saying the report is ready",expect:"comms",key:"Violet saying the report"},{text:"How many school kits are left in our Maisha inventory",expect:"programs",key:"school kits"}];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const recent=async()=>{const r=await fetch(`${SUPA}/rest/v1/events?select=payload,created_at&type=eq.mesh.routed&order=created_at.desc&limit=15`,{headers:{apikey:SVC,Authorization:"Bearer "+SVC}});return r.ok?r.json():[];};
for(let i=0;i<T.length;i++){const t=T[i];const id=`wamid.HARNESS_CP_${i}_${Math.floor(Math.random()*1e9)}`;
const body=JSON.stringify({entry:[{changes:[{value:{contacts:[{wa_id:FROM,profile:{name:"MeshTest"}}],messages:[{from:FROM,id,type:"text",text:{body:t.text}}]}}]}]});
const sig=crypto.createHmac("sha256",SECRET).update(body).digest("hex");
const r=await fetch(WEBHOOK,{method:"POST",headers:{"Content-Type":"application/json","x-hub-signature-256":`sha256=${sig}`},body});
console.log(`[${i+1}/2] "${t.text.slice(0,34)}" HTTP ${r.status}; wait 90s...`);await sleep(90000);
const m=(await recent()).find(e=>(e.payload?.command||"").includes(t.key));const got=m?m.payload?.domain:null;
console.log(`   -> ${got||"(none)"} expected ${t.expect} ${got===t.expect?"PASS":"FAIL"} conf=${m?.payload?.confidence??"?"}`);}
