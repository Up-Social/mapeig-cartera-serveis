import { SANDBOX_SYNTHETIC_TIMEOUT_MS, type DocumentSession } from './sandbox';

const EXPECTED_TEXT = ['Servei social per a persones', 'Servicio social para personas'];
const RASTER_WIDTH = 1200;
const RASTER_HEIGHT = 1600;

function pdf(objects: Array<string | Buffer>): Buffer {
  const parts = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const part = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]);
    parts.push(part);
    length += part.length;
  }
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(parts);
}

function digitalFixture(): Buffer {
  const lines = ['Document sintetic de prova.', ...EXPECTED_TEXT, 'Cap dada real. Sin datos reales.'];
  const stream = `BT /F1 18 Tf 40 700 Td 26 TL ${lines.map(line => `(${line}) Tj T*`).join(' ')} ET`;
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]);
}

/** Image-only PDF: no text layer can accidentally satisfy the OCR check. */
function scannedFixture(jpeg: Buffer): Buffer {
  if (jpeg.length < 4 || jpeg.length > 2_000_000 || jpeg.readUInt16BE(0) !== 0xffd8 || jpeg.readUInt16BE(jpeg.length - 2) !== 0xffd9) {
    throw new Error('SANDBOX_SYNTHETIC_RASTER');
  }
  const stream = 'q 612 0 0 792 0 0 cm /Im1 Do Q';
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>',
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${RASTER_WIDTH} /Height ${RASTER_HEIGHT} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from('\nendstream')]),
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ]);
}

function expectedText(value: string): boolean {
  const normalized = value.toLowerCase().replace(/\s+/gu, ' ');
  return EXPECTED_TEXT.every(text => normalized.includes(text.toLowerCase()));
}

/** Uses only generated data and installed tools; never calls AI or application storage. */
export async function verifySyntheticDocuments(session: DocumentSession): Promise<void> {
  // Shared across all operations, including file reads: per-command timeouts alone
  // would allow the sum of successful commands to exceed the activation budget.
  const signal = AbortSignal.timeout(SANDBOX_SYNTHETIC_TIMEOUT_MS);
  const run = async (command: string, args: string[], timeoutMs: number, failure: string) => {
    const result = await session.runCommand(command, args, { signal, timeoutMs });
    if (result.exitCode !== 0) throw new Error(failure);
  };
  const read = async (path: string) => {
    const content = await session.readFileToBuffer({ path }, { signal });
    if (!content) throw new Error('SANDBOX_SYNTHETIC_READ');
    return content;
  };
  await session.writeFiles([{ path: '/tmp/synthetic-digital.pdf', content: digitalFixture() }], { signal });
  await run('pdftotext', ['-layout', '/tmp/synthetic-digital.pdf', '/tmp/synthetic-digital.txt'], 10_000, 'SANDBOX_SYNTHETIC_EXTRACTION');
  if (!expectedText((await read('/tmp/synthetic-digital.txt')).toString('utf8'))) throw new Error('SANDBOX_SYNTHETIC_EXTRACTION');

  await run('pdftoppm', ['-jpeg', '-scale-to-x', String(RASTER_WIDTH), '-scale-to-y', String(RASTER_HEIGHT), '-f', '1', '-l', '1', '-singlefile', '/tmp/synthetic-digital.pdf', '/tmp/synthetic-scan'], 20_000, 'SANDBOX_SYNTHETIC_RASTER');
  const scanned = scannedFixture(await read('/tmp/synthetic-scan.jpg'));
  await session.writeFiles([{ path: '/tmp/synthetic-scanned.pdf', content: scanned }], { signal });
  await run('pdftotext', ['-layout', '/tmp/synthetic-scanned.pdf', '/tmp/synthetic-scanned.txt'], 10_000, 'SANDBOX_SYNTHETIC_EXTRACTION');
  if ((await read('/tmp/synthetic-scanned.txt')).toString('utf8').trim()) throw new Error('SANDBOX_SYNTHETIC_TEXT_LAYER');

  await run('sh', ['-c', 'exec tesseract --list-langs > /tmp/synthetic-languages.txt'], 5_000, 'SANDBOX_SYNTHETIC_LANGUAGES');
  const languages = (await read('/tmp/synthetic-languages.txt')).toString('utf8').split(/\s+/u);
  if (!languages.includes('cat') || !languages.includes('spa')) throw new Error('SANDBOX_SYNTHETIC_LANGUAGES');
  await run('pdftoppm', ['-png', '-r', '200', '-f', '1', '-l', '1', '-singlefile', '/tmp/synthetic-scanned.pdf', '/tmp/synthetic-page'], 20_000, 'SANDBOX_SYNTHETIC_RASTER');
  await run('tesseract', ['/tmp/synthetic-page.png', '/tmp/synthetic-ocr', '-l', 'cat+spa'], 45_000, 'SANDBOX_SYNTHETIC_OCR');
  if (!expectedText((await read('/tmp/synthetic-ocr.txt')).toString('utf8'))) throw new Error('SANDBOX_SYNTHETIC_OCR');
}
