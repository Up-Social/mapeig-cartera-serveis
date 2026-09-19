import {getComparisonReport} from '@/lib/comparison-report';
import {isUuid} from '@/lib/uuid';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!isUuid(id))return new Response(null,{status:400});const report=await getComparisonReport(id);return report?Response.json(report,{headers:{'Content-Disposition':`attachment; filename="comparison-${id}.json"`,'Cache-Control':'no-store'}}):new Response(null,{status:404});}
