import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { createServerSupabase } from "@/lib/records-page";

export const dynamic = "force-dynamic";

export async function GET() {
  const masterPath = process.env.MASTER_EXCEL_PATH;
  if (!masterPath)
    return Response.json(
      { error: "Falta MASTER_EXCEL_PATH a .env.local" },
      { status: 500 },
    );
  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("service_provisions")
    .select(
      "source_id,call_url,regulatory_basis_url,provider_name,provider_nif,mechanism,award_date,amount,contracting_body,target_population,source_reference,service_code",
    )
    .order("created_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length)
    return Response.json(
      { error: "No hi ha provisions aprovades per exportar." },
      { status: 409 },
    );

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(masterPath);
  const sheet = workbook.getWorksheet("Detalle_Provisiones");
  if (!sheet)
    return Response.json(
      { error: "El Master no conté el full Detalle_Provisiones." },
      { status: 500 },
    );
  const templateStyles = Array.from({ length: 12 }, (_, index) =>
    structuredClone(sheet.getCell(2, index + 1).style),
  );
  if (sheet.rowCount > 1) sheet.spliceRows(2, sheet.rowCount - 1);
  for (const item of data) {
    const row = sheet.addRow([
      item.source_id,
      hyperlink(item.call_url),
      hyperlink(item.regulatory_basis_url),
      item.provider_name,
      item.provider_nif,
      item.mechanism,
      item.award_date ? new Date(`${item.award_date}T00:00:00`) : null,
      item.amount == null ? null : Number(item.amount),
      item.contracting_body,
      item.target_population,
      item.source_reference,
      item.service_code,
    ]);
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.style = structuredClone(templateStyles[column - 1]);
    });
    row.getCell(7).numFmt = "yyyy-mm-dd";
    row.getCell(8).numFmt = "#,##0.00";
  }
  workbook.calcProperties.fullCalcOnLoad = true;
  const output = await workbook.xlsx.writeBuffer();
  const bytes = new Uint8Array(output);
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  const filename = `Master-Mapeig-Cartera-${stamp}.xlsx`;
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const { error: exportError } = await supabase.from("excel_exports").insert({
    filename,
    provision_count: data.length,
    content_hash: contentHash,
  });
  if (exportError)
    return Response.json({ error: exportError.message }, { status: 500 });
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
