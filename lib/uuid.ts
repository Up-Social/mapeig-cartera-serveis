export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function requireUuid(value: string) {
  if (!isUuid(value)) throw new Error("Identificador no vàlid.");
  return value;
}
