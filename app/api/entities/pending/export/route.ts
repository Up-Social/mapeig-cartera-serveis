import {pendingResesQuery} from "@/lib/reses-pending";
import {resesCsv} from "@/lib/reses-csv";

export async function GET(request: Request) {
  const p=new URL(request.url).searchParams;
  const rows:Array<Record<string,unknown>>=[];
  for(let offset=0;;offset+=500){
    const result=await pendingResesQuery(p.get("q")??"",p.get("county")??"totes").range(offset,offset+499);
    if(result.error) throw result.error;
    rows.push(...(result.data??[]));
    if((result.data??[]).length<500) break;
  }
  return new Response(resesCsv(rows),{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="reses-titulars-pendents.csv"',"Cache-Control":"private, no-store"}});
}
