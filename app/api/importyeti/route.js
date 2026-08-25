import { NextResponse } from 'next/server';
import processedLedger from '../../../data/processed-importers.json';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const BASE_URL=process.env.IMPORTYETI_API_BASE_URL||'https://data.importyeti.com';
const TARGET_SUPPLIER_COUNTRIES=['China','India','Vietnam','Taiwan','Bangladesh','Sri Lanka','Indonesia','Malaysia','Thailand','Philippines','Pakistan','Cambodia','South Korea','Japan','Switzerland','South Africa','United Kingdom','Algeria','Iraq','Serbia','Laos','Myanmar','Brunei','Kazakhstan','Tunisia','Nicaragua','New Zealand','Norway','Israel','Turkey'];
const permanentProcessed=new Set(Object.keys(processedLedger?.processed||{}));
function apiKey(){return process.env.IMPORTYETI_API_KEY||process.env.BTA_SERVICE_API_KEY;}
function importerId(row){return String(row?.company_link||row?.key||'').trim().toLowerCase();}
async function upstreamFetch(url,key){const response=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${key}`,'x-api-key':key},cache:'no-store'});const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}}return{response,data};}
function uniq(values,n=6){const out=[];for(const raw of values||[]){const v=String(raw||'').replace(/^id=/,'').replace(/^em(?=[A-Za-z0-9._%+-]+@)/,'').trim();if(v&&!out.includes(v))out.push(v);if(out.length>=n)break}return out;}
function countryRanking(d){const scores=new Map();for(const l of d.lane_permutations||[]){const c=l?.exit_port_country;if(c&&c!=='United States of America')scores.set(c,(scores.get(c)||0)+Number(l.shipments||0));}if(!scores.size){for(const s of d.suppliers_table||[]){const c=s?.country||s?.supplier_address_country;if(c&&c!=='United States')scores.set(c,(scores.get(c)||0)+Number(s.total_shipments_company||0));}}return [...scores.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([c])=>c);}
function profileContacts(d){const emails=[],phones=[];for(const a of d.other_addresses_contact_info||[]){emails.push(...(a?.contact_info_data?.emails||[]));phones.push(...(a?.contact_info_data?.phone_numbers||[]));}if(d.phone_number)phones.unshift(d.phone_number);return{emails:uniq(emails,5),phones:uniq(phones,5)};}
function chinaShipments(d){let n=0;for(const x of Object.values(d.time_series||{}))n+=Number(x?.china_shipments||0);return n||null;}
function compactProfile(slug,payload){const d=payload?.data||payload||{},contacts=profileContacts(d);return{slug,title:d.title||slug,address:d.address||d.address_plain||null,website:d.website||null,mainPhone:d.phone_number||contacts.phones[0]||null,emails:contacts.emails,phones:contacts.phones,supplierCountries:countryRanking(d),chinaShipments:chinaShipments(d),lastShipment:d.date_range?.end_date||d.recent_bols?.[0]?.date_formatted||null,totalShipments:d.total_shipments||null,topSuppliers:(d.suppliers_table||[]).slice(0,8).map(s=>({name:s.supplier_name||null,country:s.country||s.supplier_address_country||null,shipments:s.total_shipments_company||null}))};}

export async function GET(request){
 const key=apiKey();if(!key)return NextResponse.json({ok:false,error:'Server API key is not configured.'},{status:503});
 const incoming=new URL(request.url);
 try{
  if(incoming.searchParams.get('mode')==='profiles'){
   const slugs=String(incoming.searchParams.get('companies')||'').split(',').map(s=>s.trim()).filter(Boolean).slice(0,60);
   const results=[];let requestCost=0,creditsRemaining=null;
   for(let i=0;i<slugs.length;i+=5){const chunk=slugs.slice(i,i+5);const chunkResults=await Promise.all(chunk.map(async slug=>{const url=new URL(`/v1.0/company/${encodeURIComponent(slug)}`,BASE_URL);const{response,data}=await upstreamFetch(url,key);requestCost+=Number(data?.requestCost||0);if(data?.creditsRemaining!=null)creditsRemaining=data.creditsRemaining;return response.ok?compactProfile(slug,data?.data):{slug,error:data?.error||`HTTP ${response.status}`};}));results.push(...chunkResults)}
   return NextResponse.json({ok:true,source:'importyeti',requestCost,creditsRemaining,profiles:results},{headers:{'Cache-Control':'no-store'}});
  }
  const requestedPath=incoming.searchParams.get('path'),path=requestedPath&&requestedPath!=='/api/importers'?requestedPath:'/v1.0/powerquery/us-import/companies';
  if(!path.startsWith('/')||path.includes('://')||path.includes('..'))return NextResponse.json({ok:false,error:'Invalid upstream path.'},{status:400});
  const base=new URL(path,BASE_URL);
  for(const[name,value]of incoming.searchParams.entries()){if(['path','pageSize','page','mode','companies'].includes(name)||name.startsWith('_vercel'))continue;if(name==='search')base.searchParams.append('query',value);else base.searchParams.append(name,value)}
  if(!path.startsWith('/v1.0/powerquery/')){const{response,data}=await upstreamFetch(base,key);return NextResponse.json({ok:response.ok,status:response.status,source:'importyeti',data},{status:response.status,headers:{'Cache-Control':'no-store'}});}
  if(!base.searchParams.has('supplier_country'))base.searchParams.set('supplier_country',TARGET_SUPPLIER_COUNTRIES.join(' | '));
  if(!base.searchParams.has('company_total_shipments'))base.searchParams.set('company_total_shipments','25 TO *');
  const wanted=Math.min(100,Math.max(1,Number(incoming.searchParams.get('pageSize')||10)));
  const combined=[],batchSeen=new Set();let creditsRemaining=null,requestCost=0,totalCompanies=null,lastStatus=200,duplicatesSkipped=0,pagesScanned=0;
  for(let page=1;page<=Math.max(20,Math.ceil(wanted/10)*8)&&combined.length<wanted;page++){
   const upstream=new URL(base);upstream.searchParams.set('limit','10');upstream.searchParams.set('page',String(page));
   const{response,data}=await upstreamFetch(upstream,key);pagesScanned=page;lastStatus=response.status;
   if(!response.ok)return NextResponse.json({ok:false,status:response.status,source:'importyeti',data},{status:response.status,headers:{'Cache-Control':'no-store'}});
   requestCost+=Number(data?.requestCost||0);if(data?.creditsRemaining!=null)creditsRemaining=data.creditsRemaining;
   const payload=data?.data?.data??data?.data??[];if(data?.data?.totalCompanies!=null)totalCompanies=data.data.totalCompanies;if(!Array.isArray(payload)||!payload.length)break;
   for(const row of payload){const id=importerId(row);if(!id)continue;if(permanentProcessed.has(id)||batchSeen.has(id)){duplicatesSkipped++;continue}batchSeen.add(id);combined.push(row);if(combined.length>=wanted)break}
  }
  return NextResponse.json({ok:true,status:lastStatus,source:'importyeti',data:{requestCost,creditsRemaining,data:{data:combined.slice(0,wanted),totalCompanies},batch:{requested:wanted,returned:Math.min(wanted,combined.length),distinct:batchSeen.size,pagesScanned,duplicatesSkipped,permanentProcessedCount:permanentProcessed.size},duplicateGuard:{enabled:true,idRule:'ImportYeti company_link, falling back to normalized company key',ledger:'data/processed-importers.json'},upstreamScreen:{appliedBeforeRetrieval:true,supplierCountries:TARGET_SUPPLIER_COUNTRIES,minimumCompanyShipments:25}}},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({ok:false,error:'ImportYeti request failed.',detail:error.message},{status:502})}
}
