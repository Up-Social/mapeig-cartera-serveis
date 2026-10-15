export function resesCsv(rows: Array<Record<string, unknown>>): string {
  const keys = ["registry_number","service_name","service_type","municipality","county","capacity","address","active","source_payload_hash"];
  const cell = (value: unknown) => {
    const s = value == null ? "" : String(value);
    return `"${(/^[=+\-@\t\r]/.test(s) ? "'"+s : s).replaceAll('"','""')}"`;
  };
  return "\uFEFF" + [
    ["RESES","Servei","Tipologia","Municipi","Comarca","Capacitat","Adreça","Actiu","SHA-256 de la font","Titularitat"].map(cell).join(";"),
    ...rows.map(row=>[...keys.map(key=>row[key]),"Titular pendent d’identificar"].map(cell).join(";")),
  ].join("\r\n");
}
