import {getEcbDollarRate} from '@/lib/ecb-rate';
import {getAiCostSummary} from '@/lib/records-page';

export async function GET(){
  try{
    const [summary,rate]=await Promise.all([getAiCostSummary(),getEcbDollarRate()]);
    return Response.json({summary,rate},{headers:{'Cache-Control':'private, no-store, max-age=0'}});
  }catch{
    return Response.json({error:'No s’ha pogut actualitzar el cost de la IA.'},{status:503,headers:{'Cache-Control':'private, no-store, max-age=0'}});
  }
}
