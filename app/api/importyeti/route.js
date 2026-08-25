import { NextResponse } from 'next/server';
import processedLedger from '../../../data/processed-importers.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE_URL = process.env.IMPORTYETI_API_BASE_URL || 'https://data.importyeti.com';
const TARGET_SUPPLIER_COUNTRIES = ['China','India','Vietnam','Taiwan','Bangladesh','Sri Lanka','Indonesia','Malaysia','Thailand','Philippines','Pakistan','Cambodia','South Korea','Japan','Switzerland','South Africa','United Kingdom','Algeria','Iraq','Serbia','Laos','Myanmar','Brunei','Kazakhstan','Tunisia','Nicaragua','New Zealand','Norway','Israel','Turkey'];
const permanentProcessed = new Set(Object.keys(processedLedger?.processed || {}));

function apiKey(){return process.env.IMPORTYETI_API_KEY||process.env.BTA_SERVICE_API_KEY;}
function importerId(row){return String(row?.company_link||row?.key||'').trim().toLowerCase();}
async function upstreamFetch(url,key){const response=await fetch(url,{headers:{Accept:'application/json',Authorization:`Bearer ${key}`,'x-api-key':key},cache:'no-store'});const text=await response.text();let data;try{data=JSON.parse(text)}catch{data={raw:text}}return{response,data};}

export async function GET(request){
 const key=apiKey();if(!key)return NextResponse.json({ok:false,error:'Server API key is not configured.'},{status:503});
 const incoming=new URL(request.url),requestedPath=incoming.searchParams.get('path'),path=requestedPath&&requestedPath!=='/api/importers'?requestedPath:'/v1.0/powerquery/us-import/companies';
 if(!path.startsWith('/')||path.includes('://')||path.includes('..'))return NextResponse.json({ok:false,error:'Invalid upstream path.'},{status:400});
 const wanted=Math.min(100,Math.max(1,Number(incoming.searchParams.get('pageSize')||10))),base=new URL(path,BASE_URL);
 for(const[name,value]of incoming.searchParams.entries()){if(name==='path'||name==='pageSize'||name==='page'||name.startsWith('_vercel'))continue;if(name==='search')base.searchParams.append('query',value);else base.searchParams.append(name,value)}
 if(!base.searchParams.has('supplier_country'))base.searchParams.set('supplier_country',TARGET_SUPPLIER_COUNTRIES.join(' | '));
 if(!base.searchParams.has('company_total_shipments'))base.searchParams.set('company_total_shipments','25 TO *');
 try{
  const combined=[],batchSeen=new Set();let creditsRemaining=null,requestCost=0,totalCompanies=null,lastStatus=200,duplicatesSkipped=0,pagesScanned=0;
  // Continue paging past duplicates until we fill the requested batch with never-before-seen importer IDs.
  for(let page=1;page<=Math.max(20,Math.ceil(wanted/10)*8)&&combined.length<wanted;page++){
   const upstream=new URL(base);upstream.searchParams.set('limit','10');upstream.searchParams.set('page',String(page));
   const{response,data}=await upstreamFetch(upstream,key);pagesScanned=page;lastStatus=response.status;
   if(!response.ok)return NextResponse.json({ok:false,status:response.status,source:'importyeti',data},{status:response.status,headers:{'Cache-Control':'no-store'}});
   requestCost+=Number(data?.requestCost||0);if(data?.creditsRemaining!=null)creditsRemaining=data.creditsRemaining;
   const payload=data?.data?.data??data?.data??[];if(data?.data?.totalCompanies!=null)totalCompanies=data.data.totalCompanies;if(!Array.isArray(payload)||!payload.length)break;
   for(const row of payload){const id=importerId(row);if(!id)continue;if(permanentProcessed.has(id)||batchSeen.has(id)){duplicatesSkipped++;continue}batchSeen.add(id);combined.push(row);if(combined.length>=wanted)break}
  }
  return NextResponse.json({ok:true,status:lastStatus,source:'importyeti',data:{requestCost,creditsRemaining,data:{data:combined.slice(0,wanted),totalCompanies},batch:{requested:wanted,returned:Math.min(wanted,combined.length),distinct:batchSeen.size,pagesScanned,duplicatesSkipped,permanentProcessedCount:permanentProcessed.size},duplicateGuard:{enabled:true,idRule:'ImportYeti company_link, falling back to normalized company key',ledger:'data/processed-importers.json',policy:'Previously retrieved importer IDs are skipped. Paging continues until the requested number of NEW importers is collected or the search is exhausted.'},upstreamScreen:{appliedBeforeRetrieval:true,supplierCountries:TARGET_SUPPLIER_COUNTRIES,minimumCompanyShipments:25,note:'Broad upstream cost guard. Product/HS/industry and logistics exclusions remain second-stage BTA screening to avoid false negatives.'}}},{headers:{'Cache-Control':'no-store'}});
 }catch(error){return NextResponse.json({ok:false,error:'ImportYeti request failed.',detail:error.message},{status:502})}
}
