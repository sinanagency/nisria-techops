#!/usr/bin/env node
// Nisria Ad Grant campaign builder. Creates budgets + campaigns (PAUSED) + geo/lang/negative
// criteria via the Google Ads API, reusing the SA+DWD token engine. Stage 1 of the build.
// Idempotency: names are suffixed with a run tag; re-running makes NEW campaigns, so run once.
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const CWD = "/Users/milaaj/Code/nisria-techops/platform";
const CID = "2028365929"; const API = "https://googleads.googleapis.com/v22";
const seed = fs.readFileSync(path.join(CWD, ".env.seed"), "utf8");
const b64 = seed.split(/\r?\n/).find(l=>l.startsWith("GOOGLE_SERVICE_ACCOUNT_B64=")).slice("GOOGLE_SERVICE_ACCOUNT_B64=".length).replace(/^["']|["']$/g,"");
const s = JSON.parse(Buffer.from(b64,"base64").toString("utf8"));
const dev = execSync('security find-generic-password -a "nisria-google-ads-dev-token" -w',{encoding:"utf8"}).trim();
async function token(){
  const nowS=Math.floor(Date.now()/1000); const e=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const claim={iss:s.client_email,sub:"sasa@nisria.co",scope:"https://www.googleapis.com/auth/adwords",aud:"https://oauth2.googleapis.com/token",iat:nowS,exp:nowS+3600};
  const inp=`${e({alg:"RS256",typ:"JWT"})}.${e(claim)}`; const sig=crypto.sign("RSA-SHA256",Buffer.from(inp),s.private_key).toString("base64url");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:`${inp}.${sig}`})});
  const j=await r.json(); if(!j.access_token) throw new Error("token: "+JSON.stringify(j)); return j.access_token;
}
async function retry(fn){for(let i=0;i<5;i++){try{return await fn()}catch(e){if(i===4)throw e;await new Promise(r=>setTimeout(r,3000))}}}
let TOK;
async function mutate(service, operations, partial=false){
  const r = await retry(()=>fetch(`${API}/customers/${CID}/${service}:mutate`,{method:"POST",headers:{authorization:`Bearer ${TOK}`,"developer-token":dev,"content-type":"application/json"},body:JSON.stringify({operations, partialFailureError:undefined, partialFailure:partial})}));
  const j = await r.json();
  if(!r.ok || (j.partialFailureError && !partial)){ console.error(`✗ ${service} HTTP ${r.status}\n`+JSON.stringify(j,null,2)); throw new Error(`${service} mutate failed`); }
  if(j.partialFailureError) console.error(`(partial) ${service}:`, JSON.stringify(j.partialFailureError).slice(0,300));
  return (j.results||[]).map(x=>x.resourceName);
}

const NEGATIVES = ["jobs","job","salary","vacancy","career","careers","hiring","internship","volunteer","volunteering","intern","recruitment","apply for sponsorship","get sponsored","need sponsorship","free money","financial assistance","help me","grant application","scholarship","bursary","how to get sponsored","free","login","sign in","wikipedia","definition","meaning","scam","complaints","reviews","template","what is","near me"];
const GEO = ["2840","2826","2124","2036","2784"]; // US, UK, CA, AU, UAE
const LANG = "1000"; // English

const CAMPAIGNS = [
  { key:"brand", name:"Nisria | Brand", budget:20, neg:false },
  { key:"sponsor", name:"Nisria | Sponsor a Child", budget:180, neg:true },
  { key:"donate", name:"Nisria | Donate", budget:100, neg:true },
];

TOK = await token();
console.log("== Stage 1: budgets + campaigns + criteria ==");

// 1) budgets (already created on first run — reuse to avoid duplicates)
const budgets = [
  "customers/2028365929/campaignBudgets/15617806212",
  "customers/2028365929/campaignBudgets/15617806215",
  "customers/2028365929/campaignBudgets/15617806218",
];
console.log("budgets (reused):", budgets);

// 2) campaigns (PAUSED, SEARCH, Maximize Conversions, Presence geo targeting)
const campOps = CAMPAIGNS.map((c,i)=>({create:{
  name:c.name, status:"PAUSED", advertisingChannelType:"SEARCH", campaignBudget:budgets[i],
  maximizeConversions:{}, // conversion-based bidding -> lifts the $2 Grants CPC cap
  // Ad Grants = Google Search ONLY (no search partners, no display)
  networkSettings:{ targetGoogleSearch:true, targetSearchNetwork:false, targetContentNetwork:false, targetPartnerSearchNetwork:false },
  geoTargetTypeSetting:{ positiveGeoTargetType:"PRESENCE", negativeGeoTargetType:"PRESENCE" },
  containsEuPoliticalAdvertising:"DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
}}));
const camps = await mutate("campaigns", campOps);
console.log("campaigns:", camps);

// 3) campaign criteria: geo + language for all; negatives for sponsor/donate
const critOps = [];
camps.forEach((camp,i)=>{
  GEO.forEach(g=> critOps.push({create:{ campaign:camp, location:{ geoTargetConstant:`geoTargetConstants/${g}` } }}));
  critOps.push({create:{ campaign:camp, language:{ languageConstant:`languageConstants/${LANG}` } }});
  if(CAMPAIGNS[i].neg) NEGATIVES.forEach(n=> critOps.push({create:{ campaign:camp, negative:true, keyword:{ text:n, matchType:"BROAD" } }}));
});
const crit = await mutate("campaignCriteria", critOps, true);
console.log(`criteria created: ${crit.length} (geo+lang+negatives)`);

// emit a map for stage 2
const map = {};
CAMPAIGNS.forEach((c,i)=>{ map[c.key]={ campaign:camps[i], budget:budgets[i] }; });
fs.writeFileSync(process.env.CLAUDE_JOB_DIR+"/tmp/campaign-map.json", JSON.stringify(map,null,2));
console.log("\n✅ Stage 1 done. Map saved.\n"+JSON.stringify(map,null,2));
