import type {EuroReferenceRate} from './currency';

const ECB_DAILY_URL='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

export function parseEcbDollarRate(xml:string,now=new Date()):EuroReferenceRate|null{
  const date=xml.match(/<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const raw=xml.match(/<Cube\s+currency=['"]USD['"]\s+rate=['"]([\d.]+)['"]\s*\/>/)?.[1];
  const usdPerEuro=Number(raw);
  const when=date?Date.parse(`${date}T00:00:00Z`):NaN;
  const age=now.getTime()-when;
  if(!date||!Number.isFinite(when)||!Number.isFinite(usdPerEuro)||usdPerEuro<=0||age< -86_400_000||age>14*86_400_000)return null;
  return {date,usdPerEuro};
}

export async function getEcbDollarRate():Promise<EuroReferenceRate|null>{
  try{
    const response=await fetch(ECB_DAILY_URL,{next:{revalidate:3600},signal:AbortSignal.timeout(8000)});
    if(!response.ok)return null;
    return parseEcbDollarRate(await response.text());
  }catch{return null;}
}
