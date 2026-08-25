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
function topValues(arr,key,n=5){const seen=[];for(const x of (arr||[])){const v=String(x?.[key]||'').trim();if(v&&!seen.includes(v))seen.push(v);if(seen.length>=n)break}return seen;}
function compactProfile(slug,payload){const d=payload?.data||payload||{};const suppliers=d.suppliers_table||d.suppliers||[];const countries=topValues(suppliers,'supplier_address_country',8);const emails=topValues(d?.contact_info?.emails||d?.company_contact_info?.emails,'key',4);const phones=topValues(d?.contact_info?.phone_numbers||d?.company_contact_info?.phone_numbers,'key',4);return{slug,title:d.title||d.company_name||slug,address:d.address||d.address_plain||null,website:d.website||d.company_website||null,mainPhone:d.main_phone_number||d.company_main_phone_number||null,emails,phones,supplierCountries:countries,topSuppliers:(suppliers||[]).slice(0,8).map(s=>({name:s.supplier_name||s.name||null,country:s.supplier_address_country||s.country||null,shipments:s.total_shipments_company||s.shipments||null})),shipments12m:d.shipments_12m||null,totalShipments:d.total_shipments||d.company_total_shipments||null};}

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
