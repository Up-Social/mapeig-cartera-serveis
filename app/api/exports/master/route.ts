import {ConveniIndependentReadUnavailable,independentConveniReadersEnabled,requireConsistentConveniReads} from '@/lib/convenis/independent-read-guard';
import {appendConcertPopulationMasterNotice} from '@/lib/concerts/population-export-notice';
import { createHash, randomUUID } from "node:crypto";
import { hasUnitSchema, schemaSelect, type ExportProvision } from "@/lib/runtime-schema";
import ExcelJS from "exceljs";
import { createServerSupabase } from "@/lib/records-page";
import { readPages } from "@/lib/read-pages";
import { buildMasterCoverage, decideMasterExport, MASTER_FINANCING_TYPES, templateColumns, masterExportReadError, type MasterExportInput, type TemplateRow } from "@/lib/master-export";
import {excelCalendarDate,ExcelCalendarDateError} from "@/lib/excel-calendar-date";
import {LineReadUnavailable,requireConsistentLineReads} from '@/lib/concerts/line-read-guard';

export const dynamic = "force-dynamic";
type MasterSnapshot={provisions:Array<{id:string;snapshot:ExportProvision & MasterExportInput}>};

export async function GET() {
  const masterPath = process.env.MASTER_EXCEL_PATH;
  if (!masterPath)
    return Response.json(
      { error: "Falta MASTER_EXCEL_PATH a .env.local" },
      { status: 500 },
    );
  const supabase = createServerSupabase();
  try{await requireConsistentConveniReads(supabase);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  const independent=independentConveniReadersEnabled();
  try{if(!independent)await requireConsistentLineReads(supabase);}catch(error){if(error instanceof LineReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  const lineLedger=independent||(process.env.ENABLE_CONCERT_LINE_AWARDS==='true'&&process.env.CONCERT_LINE_READERS_READY==='true');
  let masterSnapshot: MasterSnapshot|null=null;
  let data: Array<ExportProvision & MasterExportInput>;
  try {
    if(lineLedger){
      const result=await supabase.rpc(independent?'conveni_independent_master_snapshot':'concert_line_master_snapshot');
      if(result.error)throw result.error;
      masterSnapshot=result.data as MasterSnapshot|null;
      if(!masterSnapshot||!Array.isArray(masterSnapshot.provisions))throw Error('MASTER_SNAPSHOT_INVALID');
      data=masterSnapshot.provisions.map(row=>row.snapshot);
    }else data=await readPages(async(from,to)=> {
      let query=supabase.from("conveni_reviewed_provisions")
        .select(schemaSelect("id,source_id,unit_id,centre,period,act_type,annex_reference,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code,catalog_version_id,historical_master_code,official_services(service_name),master_services(service_name),source_records(financing_type)"))
        .order("id").range(from,to);
      if(hasUnitSchema())query=query.is("superseded_at",null);
      return await query.returns<Array<ExportProvision & MasterExportInput>>();
    });
  } catch(error) {
    const diagnostic=masterExportReadError(error);
    return Response.json({error:diagnostic.message},{status:diagnostic.status});
  }
  if (!data.length)
    return Response.json({ error: "No hi ha provisions aprovades per exportar." }, { status: 409 });

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(masterPath);
  const sheet = workbook.getWorksheet("Detalle_Provisiones");
  if (!sheet)
    return Response.json(
      { error: "El Master no conté el full Detalle_Provisiones." },
      { status: 500 },
    );
  const summary=workbook.getWorksheet("Tabla (resumen)");
  if(!summary)return Response.json({error:"El Master no conté el full Tabla (resumen)."},{status:500});
  const rows:TemplateRow[]=[];
  summary.eachRow((row,rowNumber)=> {
    const value=row.getCell(1).value;
    if(rowNumber<4||typeof value!=="string"||!value.trim())return;
    const formulas:TemplateRow["formulas"]={};
    for(const type of MASTER_FINANCING_TYPES){
      const [sum,count]=templateColumns(type);
      formulas[type]={sum:row.getCell(sum).formula??null,count:row.getCell(count).formula??null};
    }
    rows.push({code:value,rowNumber,total:row.getCell(13).formula??null,formulas});
  });
  const coverage=buildMasterCoverage(rows);
  const warnings:Record<string,number>={};
  const templateStyles = Array.from({ length: 12 }, (_, index) =>
    structuredClone(sheet.getCell(2, index + 1).style),
  );
  if (sheet.rowCount > 1) sheet.spliceRows(2, sheet.rowCount - 1);
  sheet.getCell(1,12).value="Código Master documentado (clave del resumen)";
  ["Nombre servicio Cartera","ID unidad","Centro","Periodo","Tipo de acto","Anexo / página","Código oficial","Versión catálogo oficial","Motivo exclusión del resumen","Código guardado"].forEach((header,i)=>{sheet.getCell(1,13+i).value=header;});
  for (const item of data) {
    const decision=decideMasterExport(item,coverage);
    if(decision.warning)warnings[decision.warning]=(warnings[decision.warning]??0)+1;
    let awardDate:Date|null;
    try { awardDate=excelCalendarDate(item.award_date,item.source_id); }
    catch(error) {
      if(error instanceof ExcelCalendarDateError)return Response.json({error:error.message},{status:422});
      throw error;
    }
    const row = sheet.addRow([
      item.source_id,
      hyperlink(item.call_url),
      hyperlink(item.regulatory_basis_url),
      item.provider_name,
      item.provider_nif,
      decision.mechanism,
      awardDate,
      decision.amount,
      item.contracting_body,
      item.target_population,
      item.source_reference,
      decision.masterCode,
      ((Array.isArray(item.official_services)?item.official_services[0]:item.official_services) as {service_name?:string}|null)?.service_name ?? "",
      item.unit_id,item.centre,item.period,item.act_type,item.annex_reference,
      decision.officialCode,decision.catalogVersion,decision.warning,decision.storedCode,
    ]);
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      if(column <= templateStyles.length)cell.style = structuredClone(templateStyles[column - 1]);
    });
    row.getCell(7).numFmt = "yyyy-mm-dd";
    row.getCell(8).numFmt = "#,##0.00";
  }
  const notes=workbook.getWorksheet('Estat_Exportacio')??workbook.addWorksheet('Estat_Exportacio');
  notes.addRow(['El resum només inclou codis Master documentats amb fórmules verificades, tipologia coneguda i import informat.']);
  for(const [reason,count] of Object.entries(warnings))notes.addRow([reason,count]);
  appendConcertPopulationMasterNotice(notes,data);
  notes.addRow(['Cal recalcular les fórmules en una aplicació compatible abans de consultar els totals del resum.']);
  if(data.some(item=>{const source=Array.isArray(item.source_records)?item.source_records[0]:item.source_records;return source?.financing_type==='conveni';})){
    notes.addRow(['Convenis: aportació pública prevista revisada, no pagaments. Consulteu les condicions de cada anualitat a l’expedient.']);
    notes.addRow(['Total combinat de mecanismes potencialment solapat. No s’ha conciliat amb RAISC. Només inclou unitats aprovades vigents; els pendents no són zero.']);
  }
  workbook.calcProperties.fullCalcOnLoad = true;
  const output = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(output);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const filename = `Master-Mapeig-Cartera-${stamp}.xlsx`;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  try{if(!independent)await requireConsistentLineReads(supabase);}catch(error){if(error instanceof LineReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  try{await requireConsistentConveniReads(supabase);}catch(error){if(error instanceof ConveniIndependentReadUnavailable)return Response.json({error:error.message},{status:503});throw error;}
  const { error: exportError } = lineLedger
    ? await supabase.rpc(independent?'conveni_independent_master_commit':'concert_line_master_snapshot_commit',{p_receipt:randomUUID(),p_filename:filename,p_hash:contentHash,p_expected:masterSnapshot})
    : await supabase.from("excel_exports").insert({filename,provision_count:data.length,content_hash:contentHash});
  if (exportError)
    return Response.json({ error: lineLedger?'Les dades estan canviant; torna a generar el Master.':exportError.message }, { status: lineLedger?409:500 });
  return new Response(bytes, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

function hyperlink(value: string | null) {
  return value ? { text: value, hyperlink: value } : null;
}
