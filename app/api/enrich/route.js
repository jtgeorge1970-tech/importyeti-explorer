import { NextResponse } from 'next/server';

export const runtime='nodejs';

const clean=v=>String(v||'').trim();
const first=v=>Array.isArray(v)&&v.length?(v[0]?.key??v[0]):'';

function score(x){
  const shipments=Number(x.total_shipments??x.doc_count??0);
  const website=clean(first(x.company_website)||x.company_website);
  const phone=clean(x.company_main_phone_number||first(x.company_contact_info?.phone_numbers));
  const email=clean(first(x.company_contact_info?.emails));
  const recent=clean(x.company_contact_info_most_recent_found);
  let n=0; const why=[];
  if(shipments>=1000){n+=35;why.push('high import volume')} else if(shipments>=250){n+=28;why.push('strong import volume')} else if(shipments>=50){n+=18;why.push('meaningful import volume')} else if(shipments>0){n+=8;why.push('active importer')}
  if(phone){n+=22;why.push('phone available')}
  if(email){n+=22;why.push('email available')}
  if(website){n+=13;why.push('website/domain available')}
  if(recent){n+=8;why.push('recent contact evidence')}
  n=Math.min(100,n);
  const status=(n>=70&&(phone||email))?'call':n>=50?'qualified':n>=25?'research':'replace';
  return {score:n,status,why,contact:{phone:phone||null,email:email||null,website:website||null},shipments};
}

export async function POST(req){
  try{
    const body=await req.json(); const rows=Array.isArray(body?.rows)?body.rows:[];
    const data=rows.map((x,i)=>({id:x.company_link||x.key||i,company:x.key||x.name||'Unknown importer',...score(x),raw:x})).sort((a,b)=>b.score-a.score);
    return NextResponse.json({ok:true,count:data.length,data});
  }catch(e){return NextResponse.json({ok:false,error:e.message},{status:400})}
}
