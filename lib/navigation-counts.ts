import "server-only";
import { createServerSupabase } from "./records-page";
export type NavigationCounts = {review:number;issues:number;approved:number;discarded:number};
export async function getNavigationCounts():Promise<NavigationCounts>{
 const db=createServerSupabase();
 const destinations=['review','issues','approved','discarded'] as const;
 const counts=await Promise.all(destinations.map(async destination=>{
  const {count,error}=await db.from('current_record_results').select('id',{count:'exact',head:true}).eq('destination',destination);
  if(error)throw error;return [destination,count??0] as const;
 }));
 return Object.fromEntries(counts) as NavigationCounts;
}
