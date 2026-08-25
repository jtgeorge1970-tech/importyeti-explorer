import { NextResponse } from 'next/server';
export const runtime='nodejs';
const clean=v=>String(v||'').trim();
const first=v=>Array.isArray(v)&&v.length?(v[0]?.key??v[0]):'';
const text=x=>clean(x).toLowerCase();
const BAD=/(freight|forwarder|forwarding|customs broker|brokerage|logistics|shipping line|steamship|express courier)/i;
const HIGH=/(machin|equipment|steel|aluminum|solar|turbine|transformer|motor|pump|valve|electronics|semiconductor|battery|vehicle|auto part|medical device|chemical|industrial|cable|composite|marble|stone|furniture|appliance)/i;
// Conservative 2025 reciprocal-tariff opportunity weights. These are screening weights, not legal determinations.
const RATES={CN:10,IN:25,VN:20,TW:20,BD:20,LK:20,ID:19,MY:19,TH:19,PH:19,PK:19,KH:19,KR:15,JP:15,CH:39,ZA:30,GB:10,DZ:30,IQ:35,RS:35,LA:40,MM:40,SY:41,BN:25,KZ:25,TN:25,NI:18,NZ:15,NO:15,IL:15,TR:15};
function supplierCountry(x){return clean(x.supplier_country_code||x.shipper_country_code||x.origin_country_code||x.country_of_origin_code||x.supplier_country||x.shipper_country||x.origin_country||x.country_of_origin)}
function rateFor(c){const u=c.toUpperCase();if(RATES[u]!=null)return RATES[u];return c?10:0}
function prescreen(x){
 const shipments=Number(x.total_shipments??x.doc_count??0),product=clean(first(x.product_description)),hs=clean(first(x.hs_code));
 const importerCountry=clean(x.company_country_code||x.company_country),supplier=supplierCountry(x),rate=rateFor(supplier);
 const company=clean(x.key||x.name),us=/^(US|USA|UNITED STATES)$/i.test(importerCountry),bad=BAD.test(company),high=HIGH.test(product),detail=!!(product||hs);
 // Opportunity proxy intentionally combines rate and volume; a high rate with tiny volume does not automatically pass.
 const volume=Math.min(100,Math.log10(Math.max(1,shipments))*28),category=high?35:detail?15:0,opportunity=Math.round(volume*(1+rate/100)+category);
 const reasons=[];if(!us)reasons.push('not confirmed U.S. importer');if(bad)reasons.push('logistics/broker pattern');if(shipments<25)reasons.push('under 25 shipments');if(!detail)reasons.push('no product/HS detail');if(!supplier)reasons.push('supplier/origin country unavailable');if(opportunity<70)reasons.push('low opportunity proxy');
 const pass=us&&!bad&&shipments>=25&&detail&&opportunity>=70;
 return{pass,reasons,shipments,product,hs,supplierCountry:supplier||null,tariffWeight:rate||null,opportunityProxy:opportunity,highDollarCategory:high};
}
function score(x,p){
 const shipments=p.shipments,website=clean(first(x.company_website)||x.company_website),phone=clean(x.company_main_phone_number||first(x.company_contact_info?.phone_numbers)),email=clean(first(x.company_contact_info?.emails));
 let n=Math.min(55,Math.round(p.opportunityProxy*.48)),why=[`pre-screen ${p.opportunityProxy}`,p.highDollarCategory?'high-dollar category':'customs detail'];
 if(shipments>=250){n+=10;why.push('strong volume')}if(phone){n+=15;why.push('phone')}if(email){n+=15;why.push('email')}if(website){n+=8;why.push('website')}n=Math.min(100,n);
 const contactability=phone&&email?'phone + email':phone?'phone':email?'email':website?'website research':'contact research needed';
 const status=(n>=70&&(phone||email))?'call':n>=55?'qualified':'research',priority=status==='call'&&p.opportunityProxy>=100?'A':status==='call'?'B':status==='qualified'?'C':'D';
 return{score:n,status,priority,nextAction:status==='call'?'OUTREACH NOW':status==='qualified'?'ENRICH DECISION MAKER':'VERIFY COMPANY FIT',why,contactability,contact:{phone:phone||null,email:email||null,website:website||null}};
}
export async function POST(req){try{const body=await req.json(),rows=Array.isArray(body?.rows)?body.rows:[];let rejected=0;const data=[];for(let i=0;i<rows.length;i++){const x=rows[i],p=prescreen(x);if(!p.pass){rejected++;continue}data.push({id:x.company_link||x.key||i,company:x.key||x.name||'Unknown importer',...p,...score(x,p),raw:x})}data.sort((a,b)=>b.opportunityProxy-a.opportunityProxy||b.score-a.score);return NextResponse.json({ok:true,inputCount:rows.length,rejected,count:data.length,data,preScreenPolicy:{sequence:'country/origin + product/HS + volume + U.S. importer -> enrichment -> sales score',minimumShipments:25,principle:'Rank estimated opportunity, not tariff percentage alone. Start tight and loosen only if lead flow is too small.',deadlineAssumption:'Broker validates actual eligible entries and deadlines after engagement.'}})}catch(e){return NextResponse.json({ok:false,error:e.message},{status:400})}}
