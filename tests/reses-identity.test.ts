import test from "node:test";
import assert from "node:assert/strict";
import {isResesService,normalizeResesNif,resesHolder} from "../lib/reses-identity";
import {resesCsv} from "../lib/reses-csv";

test('missing official identities preserve services without inventing one shared holder',()=>{
  for(const token of [null,undefined,""," ","null","NULL"," Undefined "]){
    assert.equal(normalizeResesNif(token),"");
    const row={registre:"S00461",nom:"ARNAIC",nif:token,entitat_titular:token};
    assert.equal(isResesService(row),true);
    assert.equal(resesHolder(row),null);
  }
});
test('a holder requires an explicit name and a formatted NIF; registry is independent',()=>{
  assert.deepEqual(resesHolder({nif:"G-08458051",entitat_titular:" Entitat oficial "}),{nif:"G08458051",name:"Entitat oficial"});
  assert.equal(resesHolder({nif:"G08458051",entitat_titular:"null"}),null);
  assert.equal(resesHolder({nif:"NULL",entitat_titular:"Entitat oficial"}),null);
  assert.equal(normalizeResesNif("not-a-nif"),"");
  assert.equal(isResesService({registre:"S00461",nom:"null"}),false);
  assert.equal(isResesService({registre:"bad",nom:"Servei"}),false);
});
test('pending CSV keeps registry identities, unknown capacity, zero and spreadsheet-safe names',()=>{
  const csv=resesCsv([{registry_number:"S00001",service_name:'=BAD("x")',capacity:0},{registry_number:"S00002",service_name:"Servei",capacity:null}]);
  assert.equal(csv.split("\r\n").length,3);
  assert.ok(csv.includes('"\'=BAD(""x"")"'));
  assert.ok(csv.includes('"0"'));
  assert.ok(csv.includes('"S00002"'));
  assert.ok(csv.includes("Titular pendent d’identificar"));
});
