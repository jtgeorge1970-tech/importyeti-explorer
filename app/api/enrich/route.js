import { NextResponse } from 'next/server';
export const runtime='nodejs';
const clean=v=>String(v??'').trim();
const first=v=>Array.isArray(v)&&v.length?(v[0]?.key??v[0]):'';
const BAD=/(freight|forwarder|forwarding|customs broker|brokerage|logistics|shipping line|steamship|express courier)/i;
const HIGH=/(machin|equipment|steel|aluminum|solar|turbine|transformer|motor|pump|valve|electronics|semiconductor|battery|vehicle|auto part|medical device|chemical|industrial|cable|composite|marble|stone|furniture|appliance)/i;
// Screening weights only. Never present these as a legal tariff determination.
const RATES={CN:10,IN:25,VN:20,TW:20,BD:20,LK:20,ID:19,MY:19,TH:19,PH:19,PK:19,KH:19,KR:15,JP:15,CH:39,ZA:30,GB:10,DZ:30,IQ:35,RS:35,LA:40,MM:40,SY:41,BN:25,KZ:25,TN:25,NI:18,NZ:15,NO:15,IL:15,TR:15};
const supplierCountry=x=>clean(x.supplier_country_code||x.shipper_country_code||x.origin_country_code||x.country_of_origin_code||x.supplier_country||x.shipper_country||x.origin_country||x.country_of_origin);
const shipperName=x=>clean(first(x.shipper_name)||first(x.supplier_name)||x.shipper_name||x.supplier_name||x.manufacturer_name||x.foreign_supplier_name);
const rateFor=c=>RATES[clean(c).toUpperCase()]??(c?10:0);
function prescreen(x){
 const shipments=Number(x.total_shipments??x.doc_count??0),product=clean(first(x.product_description)),hs=clean(first(x.hs_code));
 const importerCountry=clean(x.company_country_code||x.company_country),supplier=supplierCountry(x),shipper=shipperName(x),rate=rateFor(supplier),company=clean(x.key||x.name);
 const us=/^(US|USA|UNITED STATES)$/i.test(importerCountry),bad=BAD.test(company),high=HIGH.test(product),detail=!!(product||hs),foreign=!!supplier&&!/^(US|USA|UNITED STATES)$/i.test(supplier);
 const volume=Math.min(100,Math.log10(Math.max(1,shipments))*28),category=high?35:detail?15:0,upstream=shipper?8:0,opportunity=Math.round(volume*(1+rate/100)+category+upstream);
 const reasons=[];if(!us)reasons.push('not confirmed U.S. importer');if(bad)reasons.push('logistics/broker pattern');if(shipments<25)reasons.push('under 25 shipments');if(!detail)reasons.push('no product/HS detail');if(!supplier)reasons.push('supplier/origin country unavailable');else if(!foreign)reasons.push('no confirmed foreign supplier/origin');if(opportunity<70)reasons.push('low opportunity proxy');
 const pass=us&&!bad&&shipments>=25&&detail&&foreign&&opportunity>=70;
 const upstreamSignal=shipper?'named foreign shipper/supplier':'country-level upstream signal';
 return{pass,reasons,shipments,product,hs,supplierCountry:supplier||null,shipperName:shipper||null,upstreamSignal,tariffWeight:rate||null,opportunityProxy:opportunity,highDollarCategory:high};
}
function score(x,p){
 const website=clean(first(x.company_website)||x.company_website),phone=clean(x.company_main_phone_number||first(x.company_contact_info?.phone_numbers)),email=clean(first(x.company_contact_info?.emails));
 let n=Math.min(55,Math.round(p.opportunityProxy*.46)),why=[`opportunity ${p.opportunityProxy}`,p.highDollarCategory?'high-dollar category':'customs detail',p.upstreamSignal];
 if(p.shipments>=250){n+=10;why.push('strong shipment volume')}if(p.shipperName){n+=7;why.push('actual upstream shipper named')}if(phone){n+=12;why.push('phone')}if(email){n+=12;why.push('email')}if(website){n+=6;why.push('website')}n=Math.min(100,n);
 const contactability=phone&&email?'phone + email':phone?'phone':email?'email':website?'website research':'contact research needed';
 const status=(n>=72&&(phone||email))?'call':n>=58?'qualified':'research',priority=status==='call'&&p.opportunityProxy>=105?'A':status==='call'?'B':status==='qualified'?'C':'D';
 return{score:n,status,priority,nextAction:status==='call'?'OUTREACH NOW':status==='qualified'?'ENRICH DECISION MAKER':'VERIFY COMPANY FIT',why,contactability,contact:{phone:phone||null,email:email||null,website:website||null}};
}
export async function POST(req){try{const body=await req.json(),rows=Array.isArray(body?.rows)?body.rows:[],data=[],rejectionReasons={};let rejected=0,namedShippers=0;for(let i=0;i<rows.length;i++){const x=rows[i],p=prescreen(x);if(!p.pass){rejected++;for(const reason of p.reasons)rejectionReasons[reason]=(rejectionReasons[reason]||0)+1;continue}if(p.shipperName)namedShippers++;data.push({id:x.company_link||x.key||i,company:x.key||x.name||'Unknown importer',...p,...score(x,p),raw:x})}data.sort((a,b)=>b.opportunityProxy-a.opportunityProxy||b.score-a.score);const callReady=data.filter(x=>x.status==='call').length;return NextResponse.json({ok:true,stage:'100%',inputCount:rows.length,rejected,count:data.length,callReady,namedShippers,rejectionReasons,data,preScreenPolicy:{sequence:'U.S. importer -> foreign supplier/origin -> product/HS -> meaningful volume -> upstream shipper signal -> contactability -> ranked outreach',minimumShipments:25,principle:'A U.S. office/subsidiary is not an automatic rejection. Follow the upstream foreign shipper/supplier and rank the U.S. importer by opportunity.',legalGuardrail:'Tariff weights and opportunity scores are lead-screening signals only. Broker validates actual entries, eligibility, duties and deadlines.'}})}catch(e){return NextResponse.json({ok:false,error:e.message},{status:400})}}
