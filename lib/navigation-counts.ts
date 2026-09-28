import "server-only";
import { createServerSupabase } from "./records-page";
export type NavigationCounts = {review:number;issues:number;approved:number;discarded:number};
export async function getNavigationCounts():Promise<NavigationCounts>{
 const {data,error}=await createServerSupabase().rpc('navigation_counts');
 if(error)throw error;
 const counts=(data??{}) as Partial<NavigationCounts>;
 return {review:Number(counts.review??0),issues:Number(counts.issues??0),approved:Number(counts.approved??0),discarded:Number(counts.discarded??0)};
}
