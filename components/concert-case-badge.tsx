import {concertCase,type ConcertCaseKey} from '@/lib/concerts/case-labels';

const toneClass={
 blue:'border-sky-300 bg-sky-50 text-sky-900',
 amber:'border-amber-300 bg-amber-50 text-amber-900',
 red:'border-rose-300 bg-rose-50 text-rose-900',
 violet:'border-violet-300 bg-violet-50 text-violet-900',
};

export function ConcertCaseBadge({kind}:{kind:ConcertCaseKey}){
 const item=concertCase[kind];
 return <span className={`group relative inline-flex cursor-help items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass[item.tone]}`}
   tabIndex={0} aria-label={`${item.label}. ${item.description}`} data-testid={`concert-badge-${kind}`}>
  {item.label}<span aria-hidden="true" className="pointer-events-none absolute bottom-full left-0 z-30 mb-2 hidden w-64 max-w-[80vw] rounded-lg border border-neutral-300 bg-white p-3 text-left text-xs font-normal leading-5 text-neutral-900 shadow-xl group-hover:block group-focus:block">{item.description}</span>
 </span>;
}
