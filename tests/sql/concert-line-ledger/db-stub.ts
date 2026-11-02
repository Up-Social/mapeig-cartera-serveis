import {PostgrestClient} from '@supabase/postgrest-js';
export function createServerSupabase(){return new PostgrestClient('http://127.0.0.1:3000',{headers:{authorization:'Bearer '+process.env.TEST_SYNTHETIC_JWT}});}
