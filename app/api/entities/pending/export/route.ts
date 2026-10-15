import {pendingResesQuery} from "@/lib/reses-pending";
import {resesCsv} from "@/lib/reses-csv";
import {createServerSupabase} from "@/lib/records-page";

export async function GET(request: Request) {
  const p=new URL(request.url).searchParams;
  const rows:Array<Record<string,unknown>>=[];
  for(let offset=0;;offset+=500){
    const result=await pendingResesQuery(p.get("q")??"",p.get("county")??"totes").range(offset,offset+499);
    if(result.error) throw result.error;
    if(result.data?.length){
      const proposals=await createServerSupabase().from("reses_identity_proposal_overview").select("*").eq("withdrawn",false).in("registry_number",result.data.map(s=>s.registry_number)).order("created_at",{ascending:false});
      if(proposals.error) throw proposals.error;
      rows.push(...result.data.map(s=>({...s,identity_proposals:(proposals.data??[]).filter(p=>p.registry_number===s.registry_number)})));
    }
    if((result.data??[]).length<500) break;
  }
  return new Response(resesCsv(rows),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="reses-titulars-pendents.csv"',"Cache-Control":"private, no-store"}});
}
