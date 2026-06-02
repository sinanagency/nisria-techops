#!/usr/bin/env node
// Stage 2: ad groups + keywords (Phrase+Exact) + 2 RSAs per ad group. Reads campaign-map.json.
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
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",assertion:`${inp}.${sig}`})});
  return (await r.json()).access_token;}
async function retry(fn){for(let i=0;i<5;i++){try{return await fn()}catch(e){if(i===4)throw e;await new Promise(r=>setTimeout(r,3000))}}}
let TOK;
async function mutate(service,operations,partial=false){
  const r=await retry(()=>fetch(`${API}/customers/${CID}/${service}:mutate`,{method:"POST",headers:{authorization:`Bearer ${TOK}`,"developer-token":dev,"content-type":"application/json"},body:JSON.stringify({operations,partialFailure:partial})}));
  const j=await r.json();
  if(!r.ok){console.error(`✗ ${service} HTTP ${r.status}\n`+JSON.stringify(j,null,2));throw new Error(service+" failed");}
  if(j.partialFailureError)console.error(`(partial) ${service}:`,JSON.stringify(j.partialFailureError).slice(0,400));
  return (j.results||[]).map(x=>x.resourceName);
}

// generic donation copy (<=30 headlines / <=90 desc)
const HEADS=["Sponsor a Child in Kenya","Monthly Child Sponsorship","Give a Child an Education","Change a Life Today","Fund School Fees & Supplies","Help a Kenyan Child Today","Tax-Deductible Monthly Giving","Trusted 501(c)(3) Nonprofit","Candid Silver Transparency","From a Few Dollars a Day","Your Gift Transforms a Life","Support Children in Kenya","Start Sponsoring Today","Give Hope, Give Education"];
const DESCS=["Sponsor a child in Kenya. Provide school fees, supplies, and hope. Start giving monthly.","Your monthly gift gives a Kenyan child an education and a future. 100% tax-deductible.","Join Nisria transforming children's lives in Kenya. Secure giving, transparent impact.","Every child deserves school. Sponsor a child today and change a life for good."];
const BHEADS=["Nisria Official Site","Donate to Nisria","Nisria Child Sponsorship","Sponsor a Child in Kenya","Nisria Nonprofit Charity","Support Nisria Today","Give to Nisria","Nisria 501(c)(3)","Help Children in Kenya","Tax-Deductible Giving","Monthly Child Sponsorship","Your Gift Changes Lives"];
const BDESCS=["Nisria helps children in Kenya through education and sponsorship. Give securely today.","Support Nisria's mission. Sponsor a child or make a tax-deductible gift online.","The official Nisria giving page. Your gift transforms a child's life in Kenya.","Donate to Nisria, a registered 501(c)(3). Monthly and one-time giving available."];

// ad group plan: [campaignKey, agName, themeHeadline, path1, path2, [keywords]]
const AGS=[
  ["brand","Nisria Brand","Nisria Official Site","Donate","Nisria",["nisria","by nisria","nisria charity","nisria foundation","nisria child sponsorship","nisria donate"],true],
  ["sponsor","Sponsor a Child Kenya","Sponsor a Child in Kenya","Sponsor-a-Child","Kenya",["sponsor a child in kenya","sponsor a kenyan child","child sponsorship kenya","sponsor a child in africa"],false],
  ["sponsor","Monthly Sponsorship","Monthly Child Sponsorship","Monthly","Sponsor",["monthly child sponsorship","sponsor a child monthly","child sponsorship program","sponsor a child every month"],false],
  ["sponsor","Sponsor a Child General","Sponsor a Child Today","Sponsor-a-Child","Give",["sponsor a child","sponsor a child program","how to sponsor a child","sponsor a child online"],false],
  ["sponsor","Education Sponsorship","Sponsor a Child's Education","Education","Kenya",["sponsor a child's education","fund a child's school fees","sponsor a child's schooling kenya","educate a child in kenya"],false],
  ["donate","Donate Childrens Charity","Donate to a Children's Charity","Donate","Children",["donate to childrens charity","childrens charity donation","donate to help children","best childrens charity to donate to"],false],
  ["donate","Donate Kenya Africa","Donate to Children in Kenya","Donate","Kenya",["donate to kenya charity","charity for children in africa","donate to african children","kenya children charity"],false],
  ["donate","Education Donation","Give the Gift of Education","Education","Donate",["donate school fees","fund education in africa","donate to childrens education","give the gift of education"],false],
];

TOK=await retry(token);
console.log("== Stage 2: ad groups + keywords + RSAs ==");

// 1) ad groups
const agOps=AGS.map(a=>({create:{ name:`${MAP[a[0]] && a[1]}`, campaign:MAP[a[0]].campaign, status:"ENABLED", type:"SEARCH_STANDARD" }}));
const ags=await mutate("adGroups",agOps);
console.log("ad groups:",ags.length);

// 2) keywords (Phrase + Exact for each)
const kwOps=[];
AGS.forEach((a,i)=>{ a[5].forEach(t=>{
  ["PHRASE","EXACT"].forEach(m=> kwOps.push({create:{ adGroup:ags[i], status:"ENABLED", keyword:{ text:t, matchType:m } }}));
});});
const kws=await mutate("adGroupCriteria",kwOps,true);
console.log("keywords:",kws.length);

// 3) RSAs (2 per ad group)
const adOps=[];
AGS.forEach((a,i)=>{
  const isBrand=a[6];
  const pool=isBrand?BHEADS:HEADS, descs=isBrand?BDESCS:DESCS;
  const theme=a[2];
  // RSA1: themed pinned H1 + pool
  const h1=[{text:theme,pinnedField:"HEADLINE_1"}, ...pool.filter(h=>h!==theme).slice(0,13).map(t=>({text:t}))];
  const d1=descs.map(t=>({text:t}));
  // RSA2: reordered subset (>=3 headlines, >=2 desc), no pin
  const rot=[...pool].reverse();
  const h2=[{text:theme},...rot.filter(h=>h!==theme).slice(0,6).map(t=>({text:t}))];
  const d2=[descs[1],descs[3]||descs[0],descs[2]].map(t=>({text:t}));
  [ [h1,d1], [h2,d2] ].forEach(([H,D])=> adOps.push({create:{
    adGroup:ags[i], status:"ENABLED",
    ad:{ finalUrls:["https://www.nisria.co/gift"], responsiveSearchAd:{ headlines:H, descriptions:D, path1:a[3], path2:a[4] } }
  }}));
});
const ads=await mutate("adGroupAds",adOps,true);
console.log("RSAs:",ads.length);
console.log("\n✅ Stage 2 done.");
