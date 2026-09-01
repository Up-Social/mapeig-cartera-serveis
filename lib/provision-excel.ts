import "server-only";
import ExcelJS from "exceljs";

export type ProvisionExcelRow = { source_id: string; call_url: string | null; regulatory_basis_url: string | null; provider_name: string | null; provider_nif: string | null; mechanism: string; award_date: string | null; amount: number | null; contracting_body: string | null; target_population: string | null; source_reference: string; service_code: string; service_name: string };

export async function createProvisionExcel(rows: ProvisionExcelRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Mapeig cartera de serveis";
  const sheet = workbook.addWorksheet("Detalle_Provisiones", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "ID de origen", key: "source_id", width: 22 },
    { header: "Convocatoria (enlace)", key: "call_url", width: 42 },
    { header: "Bases reguladoras (enlace)", key: "regulatory_basis_url", width: 42 },
    { header: "Nombre entidad beneficiaria", key: "provider_name", width: 36 },
    { header: "NIF entidad", key: "provider_nif", width: 16 },
    { header: "Mecanismo", key: "mechanism", width: 24 },
    { header: "Fecha concesión", key: "award_date", width: 16 },
    { header: "Importe (€)", key: "amount", width: 16 },
    { header: "Órgano contratante", key: "contracting_body", width: 34 },
    { header: "Población objetivo / beneficiarios", key: "target_population", width: 36 },
    { header: "Fuente (dataset/registro)", key: "source_reference", width: 34 },
    { header: "Código Cartera", key: "service_code", width: 18 },
    { header: "Nombre servicio Cartera", key: "service_name", width: 48 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle", wrapText: true };
  sheet.getRow(1).height = 32;
  sheet.autoFilter = { from: "A1", to: "M1" };
  for (const item of rows) {
    const row = sheet.addRow({ ...item, call_url: hyperlink(item.call_url), regulatory_basis_url: hyperlink(item.regulatory_basis_url), award_date: item.award_date ? new Date(`${item.award_date}T00:00:00`) : null, amount: item.amount == null ? null : Number(item.amount) });
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(7).numFmt = "yyyy-mm-dd";
    row.getCell(8).numFmt = "#,##0.00";
  }
  const output = await workbook.xlsx.writeBuffer(); return new Uint8Array(output);
}
function hyperlink(value: string | null) { return value ? { text: value, hyperlink: value } : null; }
