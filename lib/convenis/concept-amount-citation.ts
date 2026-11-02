import {quoteHasAmountLiteral} from './economic-citation';

/** A hint about proposed citation text, never verification or attribution.
 * Supported forms are ungrouped amounts and Catalan dot-grouped amounts;
 * other formats may still contain the value. */
export function conceptAmountInProposedCitations(cents:number|null,quotes:unknown):'not_checked'|'found'|'not_located' {
 if(!Number.isSafeInteger(cents)||cents===null||cents<0||!Array.isArray(quotes))return 'not_checked';
 const text=quotes.filter((quote):quote is string=>typeof quote==='string'&&quote.trim().length>0);
 if(!text.length)return 'not_checked';
 const whole=String(Math.floor(cents/100)),fraction=String(cents%100).padStart(2,'0');
 const grouped=whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.');
 const literals=[`${whole},${fraction}`,`${whole}.${fraction}`,`${grouped},${fraction}`];
 if(fraction==='00')literals.push(whole);
 for(const quote of text){
  if(literals.some(literal=>quoteHasAmountLiteral(quote,literal)))return 'found';
  // `groupLiteralCents` deliberately does not accept grouped integer input.
  // Normalize only for this advisory check, retaining the boundary checks of
  // quoteHasAmountLiteral; this does not change the economic parser contract.
  if(fraction==='00'&&grouped!==whole&&quoteHasAmountLiteral(quote.replaceAll(grouped,whole),whole))return 'found';
 }
 return 'not_located';
}
