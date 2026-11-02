/** Read-only integrity/dependency check. Never connects to Supabase or executes SQL. */
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(root, process.argv[2] ?? 'docs/local/concert-release-selected.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => {if (!condition) throw new Error(message);};
const read = path => readFileSync(resolve(root, path));
assert(manifest.schema_version === 1 && manifest.status === 'prepared_not_applied', 'Unexpected manifest contract');
const baseline = manifest.production_baseline;
const inventoryBytes = read(baseline.inventory_path);
assert(hash(inventoryBytes) === baseline.inventory_sha256, 'Production inventory snapshot changed');
const applied = JSON.parse(inventoryBytes).migrations.filter(row => row.remote).map(row => row.remote).sort();
assert(applied.length === baseline.applied_count && applied.at(-1) === baseline.latest_applied, 'Production baseline differs');
const snapshotBytes = read(baseline.function_snapshot_path);
assert(hash(snapshotBytes) === baseline.function_snapshot_sha256, 'Remote function snapshot changed');
const remoteRows = JSON.parse(snapshotBytes).rows;
const remoteFunctions = new Set(remoteRows.map(row => row.proname));
// The captured base signatures have scalar/default-scalar arguments only.
// Validate their identities, not merely the existence of a same-named overload.
const remoteSignatures = new Set(remoteRows.map(row => `public.${row.proname}(${row.arguments.split(',')
  .map(argument => argument.split(/ DEFAULT /i)[0].trim().replace(/^\w+\s+/, '').replaceAll(' ', '')).join(',')})`));
for (const signature of manifest.base_regprocedures) assert(remoteSignatures.has(signature), `Missing base signature in snapshot: ${signature}`);
const selected = new Set(manifest.selected.map(item => item.version));
assert(selected.size === manifest.selected.length, 'Duplicate selected version');
const files = readdirSync(resolve(root, 'supabase/migrations')).filter(name => /^\d{14}_.+\.sql$/.test(name)).sort();
const providers = new Map();
const introduced = new Set();
const createObjects = /create\s+(?:or\s+replace\s+)?(?:function|table(?:\s+if\s+not\s+exists)?|view)\s+(?:public\.)?([\w]+)/gi;
for (const file of files) {
  const sql = read(`supabase/migrations/${file}`).toString('utf8');
  for (const match of sql.matchAll(createObjects)) if (!providers.has(match[1])) providers.set(match[1], file.slice(0, 14));
}
let previous = baseline.latest_applied;
for (const item of manifest.selected) {
  assert(item.version > previous, `Selection order is not strictly ascending: ${item.version}`);
  previous = item.version;
  assert(!applied.includes(item.version), `Already applied: ${item.version}`);
  assert(item.path.startsWith(`supabase/migrations/${item.version}_`) && item.path.endsWith('.sql'), `Unexpected migration path: ${item.path}`);
  const bytes = read(item.path);
  assert(hash(bytes) === item.sha256, `Migration changed: ${item.path}`);
  for (const dependency of item.depends_on) assert(dependency < item.version && (selected.has(dependency) || applied.includes(dependency)), `Missing/out-of-order dependency: ${item.version} -> ${dependency}`);
  const sql = bytes.toString('utf8');
  // Conservative token-based dependency closure supplements the explicitly
  // reviewed patch/guard order in depends_on. This is not a PostgreSQL parser.
  for (const token of new Set(sql.match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
    const provider = providers.get(token);
    if (provider && provider > baseline.latest_applied && provider < item.version) {
      assert(item.depends_on.includes(provider), `Undeclared introduction dependency: ${item.version} -> ${provider} (${token})`);
    }
  }
  for (const match of sql.matchAll(/'public\.([^']+)'\s*::regprocedure/g)) {
    const name = match[1].split('(')[0];
    assert(remoteFunctions.has(name) || introduced.has(name), `Unavailable patch target: ${item.version} -> ${match[1]}`);
  }
  for (const match of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi)) introduced.add(match[1]);
  assert(!(item.version >= '20261030053000' && item.version <= '20261030063000')
    && item.version !== '20261030068000'
    && !(item.version >= '20261030072000' && item.version <= '20261030075000')
    && !(item.version >= '20261102010000' && item.version <= '20261102011000'), `Excluded candidate leaked into release: ${item.version}`);
}
const excluded = new Set(manifest.excluded.map(item => item.version));
for (const file of files) {
  const version = file.slice(0, 14);
  assert(applied.includes(version) || selected.has(version) || excluded.has(version), `Unclassified migration: ${file}`);
}
assert([...excluded].every(version => !selected.has(version)), 'Selection/exclusion overlap');
console.log(JSON.stringify({status: 'static_manifest_valid', selected: selected.size, excluded: excluded.size, baselineApplied: applied.length,
  limitation: 'Read-only file integrity and declared dependency checks; SQL execution, effective patch anchors, remote grants and functional acceptance are not tested.'}, null, 2));
