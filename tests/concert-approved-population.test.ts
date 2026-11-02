import assert from 'node:assert/strict';
import {test} from 'node:test';
import {renderToStaticMarkup} from 'react-dom/server';
import {ConcertApprovedPopulation} from '../components/concert-line-award';

const line={recordId:'record',unitId:'unit',jobId:'new-job',page:1};
test('an approved line has one editable population observation when the server confirms its predecessor',()=>{
 const component=ConcertApprovedPopulation({...line,enabled:true,previousId:'previous-job-decision'});
 assert.ok(component);
 assert.equal(component.props.editable,true);
 assert.equal(component.props.jobId,'new-job');
 const html=renderToStaticMarkup(component);
 assert.equal((html.match(/aria-label="Població de la línia"/g)??[]).length,1);
});
test('an approved line stays read-only when the individual review is unavailable or has no predecessor',()=>{
 for(const props of [{enabled:false,previousId:null},{enabled:true,previousId:null}] as const){
  const component=ConcertApprovedPopulation({...line,...props});
  assert.ok(component);
  assert.equal(component.props.editable,false);
  assert.equal((renderToStaticMarkup(component).match(/aria-label="Població de la línia"/g)??[]).length,1);
 }
 assert.equal(ConcertApprovedPopulation({...line,enabled:null,previousId:null}),null);
});
