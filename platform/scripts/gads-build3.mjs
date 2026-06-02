#!/usr/bin/env node
// Stage 3: assets (sitelinks, callouts, structured snippet) + link to all 3 campaigns.
import crypto from "node:crypto"; import fs from "node:fs"; import path from "node:path"; import { execSync } from "node:child_process";
const CWD="/Users/milaaj/Code/nisria-techops/platform"; const CID="2028365929"; const API="https://googleads.googleapis.com/v22";
const seed=fs.readFileSync(path.join(CWD,".env.seed"),"utf8");
const b64=seed.split(/\r?\n/).find(l=>l.startsWith("GOOGLE_SERVICE_ACCOUNT_B64=")).slice("GOOGLE_SERVICE_ACCOUNT_B64=".length).replace(/^["']|["']$/g,"");
const s=JSON.parse(Buffer.from(b64,"base64").toString("utf8"));
const dev=execSync('security find-generic-password -a "nisria-google-ads-dev-token" -w',{encoding:"utf8"}).trim();
const MAP=JSON.parse(fs.readFileSync(process.env.CLAUDE_JOB_DIR+"/tmp/campaign-map.json","utf8"));
async function token(){const nowS=Math.floor(Date.now()/1000);const e=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const claim={iss:s.client_email,sub:"sasa@nisria.co",scope:"https://www.googleapis.com/auth/adwords",aud:"https://oauth2.googleapis.com/token",iat:nowS,exp:nowS+3600};
  const inp=`${e({alg:"RS256",typ:"JWT"})}.${e(claim)}`;const sig=crypto.sign("RSA-SHA256",Buffer.from(inp),s.private_key).toString("base64url");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:`${inp}.${sig}`})});return (await r.json()).access_token;}
async function retry(fn){for(let i=0;i<5;i++){try{return await fn()}catch(e){if(i===4)throw e;await new Promise(r=>setTimeout(r,3000))}}}
let TOK;
async function mutate(service,operations,partial=false){
  const r=await retry(()=>fetch(`${API}/customers/${CID}/${service}:mutate`,{method:"POST",headers:{authorization:`Bearer ${TOK}`,"developer-token":dev,"content-type":"application/json"},body:JSON.stringify({operations,partialFailure:partial})}));
  const j=await r.json();
  if(!r.ok){console.error(`✗ ${service} HTTP ${r.status}\n`+JSON.stringify(j,null,2));throw new Error(service+" failed");}
  if(j.partialFailureError)console.error(`(partial) ${service}:`,JSON.stringify(j.partialFailureError).slice(0,400));
  return (j.results||[]).map(x=>x.resourceName);
}
TOK=await retry(token);
const GIFT="https://www.nisria.co/gift", HOME="https://www.nisria.co";
console.log("== Stage 3: assets ==");

const sitelinks=[["Sponsor a Child",GIFT],["Give Monthly",GIFT],["Make a One-Time Gift",GIFT],["Our Programs",HOME],["Where Your Money Goes",HOME],["About Nisria",HOME]];
const callouts=["501(c)(3) Nonprofit","Tax-Deductible","Secure Online Giving","Transparent Impact","Candid Silver Seal","Kenya Child Sponsorship"];
const snippetValues=["Education","School Fees","School Supplies","Child Sponsorship","Monthly Giving"];

const slRes=await mutate("assets", sitelinks.map(([t,u])=>({create:{ sitelinkAsset:{ linkText:t }, finalUrls:[u] }})));
const coRes=await mutate("assets", callouts.map(t=>({create:{ calloutAsset:{ calloutText:t } }})));
const ssRes=await mutate("assets", [{create:{ structuredSnippetAsset:{ header:"Services", values:snippetValues } }}]);
console.log(`assets: ${slRes.length} sitelinks, ${coRes.length} callouts, ${ssRes.length} snippet`);

// link to all campaigns
const links=[];
Object.values(MAP).forEach(({campaign})=>{
  slRes.forEach(a=>links.push({create:{ campaign, asset:a, fieldType:"SITELINK" }}));
  coRes.forEach(a=>links.push({create:{ campaign, asset:a, fieldType:"CALLOUT" }}));
  ssRes.forEach(a=>links.push({create:{ campaign, asset:a, fieldType:"STRUCTURED_SNIPPET" }}));
});
const linked=await mutate("campaignAssets", links, true);
console.log(`campaign asset links: ${linked.length}`);
console.log("\n✅ Stage 3 done.");
