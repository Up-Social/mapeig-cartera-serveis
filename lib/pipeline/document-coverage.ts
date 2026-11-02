/** Pure extraction coverage checks shared by server and browser code. */
export const HTML_COVERAGE_POLICY='html-text-coverage-v1';
export function hasCurrentTextCoverage(method:string|null,coverage:unknown,mimeType:string|null=null,partial:boolean|null|undefined=undefined){
 if(partial===true||(typeof coverage==='object'&&coverage!==null&&'complete' in coverage&&coverage.complete===false))return false;
 const htmlOrText=method==='html-basic'||mimeType?.includes('html')||mimeType==='text/plain';
 if(htmlOrText)return typeof coverage==='object'&&coverage!==null&&'policy' in coverage&&coverage.policy===HTML_COVERAGE_POLICY&&'complete' in coverage&&coverage.complete===true;
 // Unknown historical metadata cannot certify that an HTML/text extraction was complete.
 return typeof method==='string'&&/^(?:pdf-(?:text|ocr)-markdown-v2|pdftotext(?:-layout)?|pdf-text)$/.test(method);
}
