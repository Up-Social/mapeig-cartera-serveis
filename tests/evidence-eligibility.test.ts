import test from "node:test";
import assert from "node:assert/strict";
import {
  documentQuality,
  evidenceRejectionReasons,
  isEligibleEvidence,
  isGenericPortalText,
  isSubstantiveEvidenceQuote,
} from "../lib/evidence-eligibility";

test("the generic e-Tauler shell is never eligible matching evidence", () => {
  const content = "e-TAULER - Consorci Administració Oberta de Catalunya";
  assert.equal(isGenericPortalText(content), true);
  assert.equal(isEligibleEvidence({ content, textLength: content.length, extractionMethod: "html-basic" }), false);
  assert.deepEqual(evidenceRejectionReasons({ content, textLength: content.length, extractionMethod: "html-basic" }), ["generic_portal", "short_text", "basic_html_only"]);
  assert.equal(isSubstantiveEvidenceQuote(content), false);
});

test("short, duplicate and JavaScript-only evidence remains distinguishable", () => {
  assert.ok(evidenceRejectionReasons({ content: "Servei breu", textLength: 12 }).includes("short_text"));
  assert.ok(evidenceRejectionReasons({ content: "Contingut oficial ".repeat(30), textLength: 540, qualityFlags: ["duplicate_text"] }).includes("duplicate_text"));
  assert.ok(evidenceRejectionReasons({ content: "Enable JavaScript to continue", textLength: 30 }).includes("javascript_shell"));
});

test("substantive official evidence remains eligible", () => {
  const content = "La resolució acredita un servei de centre de dia per a persones grans en situació de dependència, amb vint-i-cinc places concertades i atenció professional continuada. ".repeat(3);
  assert.equal(isEligibleEvidence({ content, textLength: content.length, extractionMethod: "pdftotext", qualityFlags: [] }), true);
  assert.equal(isSubstantiveEvidenceQuote("servei de centre de dia per a persones grans en situació de dependència"), true);
  assert.deepEqual(documentQuality(content, "pdftotext").qualityFlags, ["short_text"]);
});

test('a readable excerpt cannot stand in for a document whose extraction coverage is unknown',()=>{
 const content='Resolució de servei social per a persones amb discapacitat amb activitats i suport documentat. '.repeat(20);
 assert.ok(evidenceRejectionReasons({content,textLength:content.length,coverageVerified:false}).includes('incomplete_extraction'));
 assert.equal(isEligibleEvidence({content,textLength:content.length,coverageVerified:true}),true);
});

test('a failed declared annex blocks complete matching without treating other links as required annexes',async()=>{
 const {unavailableDeclaredAnnexes,missingDeclaredAnnexIds}=await import('../lib/cloud/evidence-window');
 const annex={document_type:'annex',status:'fetched',extraction_partial:false,text_length:1000,extraction_method:'pdftotext',extraction_coverage:null,mime_type:'application/pdf',quality_flags:[]};
 assert.equal(unavailableDeclaredAnnexes([annex]).length,0);
 assert.deepEqual(missingDeclaredAnnexIds([{...annex,id:'a'}],[]),['a']);
 assert.deepEqual(missingDeclaredAnnexIds([{...annex,id:'a'}],[{source_document_id:'a'}]),[]);
 for(const patch of [{status:'error'},{extraction_partial:true},{quality_flags:['incomplete_extraction']},{text_length:0},{quality_flags:['javascript_shell']},{extraction_method:'html-basic',mime_type:'text/html'}])assert.equal(unavailableDeclaredAnnexes([{...annex,...patch}]).length,1);
 assert.equal(unavailableDeclaredAnnexes([{...annex,document_type:'regulatory_basis',status:'error'}]).length,0);
});
