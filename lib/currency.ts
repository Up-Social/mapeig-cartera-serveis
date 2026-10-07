export type EuroReferenceRate = {date:string;usdPerEuro:number};

export function eurFromUsd(usd:number,rate:EuroReferenceRate):number{
  return usd/rate.usdPerEuro;
}

export function formatAiCost(usd:number,rate:EuroReferenceRate|null,maximumFractionDigits=5):string{
  const currency=rate?'EUR':'USD';
  const amount=rate?eurFromUsd(usd,rate):usd;
  return new Intl.NumberFormat('ca-ES',{
    style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits,
  }).format(amount);
}
