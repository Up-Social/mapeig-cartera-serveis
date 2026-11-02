import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HISTORICAL_CONCERT_TERMS,HistoricalScanIncomplete,validateHistoricalConcertScan,type HistoricalEdict,type HistoricalPage,type HistoricalQuery} from '../lib/concerts/historical-discovery';

const edict=(id:string,date:string,title='Concert social'):HistoricalEdict=>({id_edicte:id,titol:title,descripcio:'Document sintètic',data_publicacio:date});
const page=(rows:HistoricalEdict[],currentPage=0,totalEdictes=rows.length,totalPages=Math.ceil(totalEdictes/25)):HistoricalPage=>({currentPage,totalEdictes,totalPages,edictes:rows});
const queries=(first:HistoricalPage[],second:HistoricalPage[]=[page([])]):HistoricalQuery[]=>[
 {term:HISTORICAL_CONCERT_TERMS[0],pages:first},{term:HISTORICAL_CONCERT_TERMS[1],pages:second},
];
function fails(input:HistoricalQuery[],code:string){assert.throws(()=>validateHistoricalConcertScan(input),error=>error instanceof HistoricalScanIncomplete&&error.code===code);}

test('historical scan checks both complete queries and keeps only exact matches in 2020–2023',()=>{
 const rows=[edict('1','2019-12-31'),edict('2','2020-01-01'),edict('3','2023-12-31T12:00:00Z'),edict('4','2024-01-01'),edict('5','2022-01-01','Altres anuncis')];
 const result=validateHistoricalConcertScan(queries([page(rows)]));
 assert.deepEqual(result.records.map(r=>r.sourceRecordId),['etauler:1:2','etauler:1:3']);
 assert.deepEqual(result.window,{from:'2020-01-01',to:'2023-12-31'});
 assert.equal(result.coverage,'pages_validated_not_source_exhaustive');
 assert.equal(result.pagesRead,2);assert.equal(result.rowsRead,5);
});

test('same edict across terms is merged but differing substantive fields fail closed',()=>{
 const same=edict('10','2022-06-01','Concert social i gestió delegada social');
 const result=validateHistoricalConcertScan(queries([page([same])],[page([same])]));
 assert.equal(result.records.length,1);assert.deepEqual(result.records[0].matchedTerms,[...HISTORICAL_CONCERT_TERMS]);
 fails(queries([page([same])],[page([{...same,descripcio:'Canvi substantiu'}])]),'EDICT_CHANGED_BETWEEN_QUERIES');
 fails(queries([page([same])],[page([{...same,titol:'Anunci sense coincidència'}])]),'EDICT_CHANGED_BETWEEN_QUERIES');
});

test('pagination requires every page, unchanged counts, correct page and unique IDs',()=>{
 const rows=Array.from({length:26},(_,index)=>edict(String(index+1),'2021-06-01'));
 const first=page(rows.slice(0,25),0,26,2),second=page(rows.slice(25),1,26,2);
 assert.equal(validateHistoricalConcertScan(queries([first,second])).records.length,26);
 fails(queries([first]),'PAGINATION_INCOMPLETE');
 fails(queries([first,{...second,totalEdictes:27}]),'PAGINATION_CHANGED');
 fails(queries([first,{...second,currentPage:0}]),'PAGINATION_CHANGED');
 fails(queries([first,{...second,edictes:[rows[0]]}]),'DUPLICATE_QUERY_EDICT');
 fails(queries([first,{...second,edictes:[]}]),'PAGE_ROW_COUNT_CHANGED');
});

test('malformed dates, invalid IDs, missing query or implausible page counts cannot complete a scan',()=>{
 fails(queries([page([edict('1','2021-02-29')])]),'INVALID_PUBLICATION_DATE');
 fails(queries([page([edict('unsafe/id','2021-02-01')])]),'INVALID_EDICT');
 fails([{term:HISTORICAL_CONCERT_TERMS[0],pages:[page([])]}],'QUERY_SET_INCOMPLETE');
 fails(queries([page([],0,25,1)]),'PAGE_ROW_COUNT_CHANGED');
 fails(queries([page([],0,125_001,5001)]),'PAGINATION_INVALID');
});
