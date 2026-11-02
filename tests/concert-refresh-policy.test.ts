import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isConcertRefreshNavigationDocument,isConfirmedConcertNavigationShell} from '../lib/concerts/refresh-policy';

test('identified generic navigation stays outside documentary evidence refresh', () => {
  for (const flag of ['generic_portal', 'javascript_shell']) {
    assert.equal(isConcertRefreshNavigationDocument({document_type:'other',quality_flags:[flag]}),true);
    assert.equal(isConcertRefreshNavigationDocument({document_type:'other',quality_flags:['incomplete_extraction',flag]}),true);
  }
});

test('legacy incomplete e-Tauler navigation is skipped only after a fresh shell check',async()=>{
 const doc={document_type:'other',source_fields:['record_url'],quality_flags:['incomplete_extraction'],url:'https://tauler.seu-e.cat/detall?idEns=1&idEdicte=123'};
 const make=(html:string,mimeType='text/html')=>async()=>({bytes:Buffer.from(html),mimeType,finalUrl:doc.url,status:200});
 const shell='<title>e-TAULER - Consorci Administració Oberta de Catalunya</title><script src="/app.js"></script>';
 assert.equal(await isConfirmedConcertNavigationShell(doc,make(shell)),true);
 for(const html of [shell+'<p>Resolució i contingut</p>',shell+'<script>window.data={}</script>',shell+'<iframe src="/x"></iframe>'])
  assert.equal(await isConfirmedConcertNavigationShell(doc,make(html)),false);
 assert.equal(await isConfirmedConcertNavigationShell({...doc,document_type:'publication'},make(shell)),false);
 assert.equal(await isConfirmedConcertNavigationShell({...doc,url:'https://example.com/detall?idEns=1&idEdicte=123'},make(shell)),false);
 assert.equal(await isConfirmedConcertNavigationShell(doc,make(shell,'application/pdf')),false);
 assert.equal(await isConfirmedConcertNavigationShell(doc,async()=>{throw Error('unavailable');}),false);
});

test('substantive and unclassified documents cannot be skipped as navigation', () => {
  for (const document_type of ['publication','annex','resolution',null,undefined,'']) {
    assert.equal(isConcertRefreshNavigationDocument({document_type,quality_flags:['generic_portal','javascript_shell']}),false);
  }
});

test('missing fields, corruption and incomplete extraction never justify skipping a document', () => {
  for (const quality_flags of [null,undefined,[],['corrupt_text'],['incomplete_extraction'],['short_text'],['corrupt_text','incomplete_extraction']]) {
    assert.equal(isConcertRefreshNavigationDocument({document_type:'other',quality_flags}),false);
  }
});
