import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { verifySyntheticDocuments } from '../lib/cloud/sandbox-synthetic';
import type { DocumentSession } from '../lib/cloud/sandbox';

const text = 'Servei social per a persones. Servicio social para personas.';
function fixture(overrides: Record<string, Buffer | null> = {}) {
  const files = new Map<string, Buffer>();
  const calls: Array<{ command: string; args: string[]; timeoutMs: number; signal: AbortSignal }> = [];
  const reads: Record<string, Buffer> = {
    '/tmp/synthetic-digital.txt': Buffer.from(text),
    // Minimal JPEG envelope for PDF structure testing; real encoding is Poppler's responsibility.
    '/tmp/synthetic-scan.jpg': Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    '/tmp/synthetic-scanned.txt': Buffer.from('\f\n'),
    '/tmp/synthetic-languages.txt': Buffer.from('List of available languages (3):\ncat\neng\nspa\n'),
    '/tmp/synthetic-ocr.txt': Buffer.from(text),
  };
  const signals: AbortSignal[] = [];
  const session = {
    writeFiles: async (input: Array<{ path: string; content: Buffer }>, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      for (const file of input) files.set(file.path, file.content);
    },
    readFileToBuffer: async ({ path }: { path: string }, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
      return path in overrides ? overrides[path] : reads[path] ?? null;
    },
    runCommand: async (command: string, args: string[], options: { timeoutMs: number; signal: AbortSignal }) => {
      calls.push({ command, args, ...options }); signals.push(options.signal);
      return { exitCode: 0 };
    },
  } as unknown as DocumentSession;
  return { session, files, calls, signals };
}

test('synthetic check uses a real digital PDF structure and an image-only PDF without a text layer', async () => {
  const f = fixture();
  await verifySyntheticDocuments(f.session);
  const digitalTask = getDocument({ data: new Uint8Array(f.files.get('/tmp/synthetic-digital.pdf')!), useSystemFonts: true });
  const scannedTask = getDocument({ data: new Uint8Array(f.files.get('/tmp/synthetic-scanned.pdf')!) });
  const [digital, scanned] = await Promise.all([digitalTask.promise, scannedTask.promise]);
  try {
    assert.equal(digital.numPages, 1);
    const content = await (await digital.getPage(1)).getTextContent();
    const extracted = content.items.map(item => 'str' in item ? item.str : '').join(' ');
    assert.match(extracted, /Servei social per a persones/);
    assert.match(extracted, /Servicio social para personas/);
    assert.equal(scanned.numPages, 1);
    assert.equal((await (await scanned.getPage(1)).getTextContent()).items.length, 0);
  } finally { await digitalTask.destroy(); await scannedTask.destroy(); }
  assert.equal(new Set(f.signals).size, 1, 'Every I/O operation shares the total deadline');
  assert.ok(f.calls.every(call => call.timeoutMs > 0 && call.timeoutMs <= 45_000));
  const ocr = f.calls.find(call => call.command === 'tesseract');
  assert.deepEqual(ocr?.args.slice(-2), ['-l', 'cat+spa']);
  const raster = f.calls.find(call => call.command === 'pdftoppm' && call.args.includes('-png'));
  assert.ok(raster?.args.includes('/tmp/synthetic-scanned.pdf'), 'OCR must consume the scanned PDF, not the digital original');
});

for (const [name, path, value, expected] of [
  ['missing digital text', '/tmp/synthetic-digital.txt', Buffer.from(''), 'EXTRACTION'],
  ['invalid raster', '/tmp/synthetic-scan.jpg', Buffer.from('not a jpeg'), 'RASTER'],
  ['unexpected scan text layer', '/tmp/synthetic-scanned.txt', Buffer.from(text), 'TEXT_LAYER'],
  ['missing Spanish model', '/tmp/synthetic-languages.txt', Buffer.from('cat\neng'), 'LANGUAGES'],
  ['missing Catalan model', '/tmp/synthetic-languages.txt', Buffer.from('spa\neng'), 'LANGUAGES'],
  ['OCR reads only one language', '/tmp/synthetic-ocr.txt', Buffer.from('Servei social per a persones'), 'OCR'],
  ['missing OCR output', '/tmp/synthetic-ocr.txt', null, 'READ'],
] as const) {
  test(`synthetic check rejects ${name}`, async () => {
    const f = fixture({ [path]: value });
    await assert.rejects(verifySyntheticDocuments(f.session), new RegExp(`SANDBOX_SYNTHETIC_${expected}`));
  });
}

test('a failed tool exits before attempting subsequent synthetic operations', async () => {
  const f = fixture();
  f.session.runCommand = async () => ({ exitCode: 127 }) as Awaited<ReturnType<DocumentSession['runCommand']>>;
  await assert.rejects(verifySyntheticDocuments(f.session), /SANDBOX_SYNTHETIC_EXTRACTION/);
  assert.equal(f.files.size, 1);
});
