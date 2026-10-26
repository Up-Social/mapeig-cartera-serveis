import test from 'node:test';
import assert from 'node:assert/strict';
import {APIError, Sandbox, Snapshot} from '@vercel/sandbox';
import {inspectSandboxInventory, readSandboxInventory, SandboxInventoryError, type SandboxInventory} from '../lib/cloud/sandbox-inventory';

const inventory = (): SandboxInventory => ({capturedAt: new Date().toISOString(), sandboxes: [], snapshots: [
  {id:'base',sourceSessionId:'builder',status:'created',sizeBytes:800,createdAt:1,creationMethod:'manual'},
]});
test('inventory accepts only a usable manual base with no automatic retention', () => {
  assert.equal(inspectSandboxInventory(inventory(), 'base').healthy, true);
  assert.equal(inspectSandboxInventory(inventory(), undefined).healthy, false);
  const expired = inventory(); expired.snapshots[0].expiresAt = 1;
  assert.equal(inspectSandboxInventory(expired, 'base').healthy, false);
});
test('automatic and unknown retained snapshots block even when their sandbox stopped', () => {
  for (const creationMethod of ['automatic', undefined, 'new_unknown_method']) {
    const value=inventory();
    value.snapshots.push({...value.snapshots[0],id:'run',creationMethod});
    value.sandboxes.push({name:'finished',currentSessionId:'s',status:'stopped',persistent:true,createdAt:1});
    assert.equal(inspectSandboxInventory(value,'base').healthy,false);
  }
});
test('deleted snapshots are excluded; active persistent machines block', () => {
  const value=inventory();
  value.snapshots.push({...value.snapshots[0],id:'deleted',status:'deleted',creationMethod:'automatic'});
  assert.equal(inspectSandboxInventory(value,'base').snapshotCount,1);
  value.sandboxes.push({name:'live',currentSessionId:'s',status:'running',persistent:true,createdAt:1});
  assert.equal(inspectSandboxInventory(value,'base').healthy,false);
  value.sandboxes[0].persistent=false;
  assert.equal(inspectSandboxInventory(value,'base').healthy,true);
});

for (const mode of ['complete', 'partial_failure', 'cancelled'] as const) {
  test(`inventory SDK pagination (${mode}) never treats partial results as complete`, async context => {
    const originalSnapshots = Snapshot.list;
    const originalSandboxes = Sandbox.list;
    const controller = new AbortController();
    const deadlines: number[] = [];
    context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { deadlines.push(milliseconds); return controller.signal; });
    const pages: string[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get('project'), 'synthetic-project');
      assert.equal(url.searchParams.get('limit'), '100');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.signal, controller.signal);
      const snapshots = url.pathname.endsWith('/snapshots');
      const page = Number(url.searchParams.get('cursor') ?? '0');
      pages.push(`${snapshots ? 'snapshots' : 'sandboxes'}:${page}`);
      if (snapshots && page === 1 && mode === 'partial_failure') {
        return Response.json({error:{code:'forbidden',message:'synthetic test failure'}},{status:403});
      }
      if (snapshots && page === 1 && mode === 'cancelled') controller.abort(new Error('INVENTORY_DEADLINE'));
      const items = snapshots
        ? [{id:`snapshot-${page}`,sourceSessionId:`session-${page}`,status:'created',sizeBytes:800,createdAt:1,updatedAt:1,region:'iad1',creationMethod:'manual'}]
        : [{name:`sandbox-${page}`,persistent:false,status:'stopped',currentSessionId:`session-${page}`,createdAt:1,updatedAt:1}];
      return Response.json({[snapshots ? 'snapshots' : 'sandboxes']:items,pagination:{count:1,next:page < 2 ? String(page+1) : null}});
    };
    // Run the installed SDK paginator and schema validation with a synthetic transport.
    // Explicit dummy credentials avoid local credential discovery and all network access.
    const access = {teamId:'synthetic-team',projectId:'synthetic-project',token:'synthetic-token',fetch:fakeFetch};
    Snapshot.list = params => originalSnapshots.call(Snapshot, {...params,...access});
    Sandbox.list = params => originalSandboxes.call(Sandbox, {...params,...access});
    try {
      if (mode === 'complete') {
        const result = await readSandboxInventory();
        assert.deepEqual(result.snapshots.map(snapshot=>snapshot.id), ['snapshot-0','snapshot-1','snapshot-2']);
        assert.deepEqual(result.sandboxes.map(sandbox=>sandbox.name), ['sandbox-0','sandbox-1','sandbox-2']);
        assert.equal(pages.length,6);
      } else {
        await assert.rejects(readSandboxInventory());
        assert.ok(pages.includes('snapshots:1'));
      }
      assert.deepEqual(deadlines,[45_000]);
    } finally {Snapshot.list=originalSnapshots;Sandbox.list=originalSandboxes;}
  });
}

test('inventory diagnostics identify the failing collection without leaking provider data', async context => {
  const secret = 'private-token-and-document-content';
  const cases = [
    {error:new APIError(Response.json({}, {status:403}), {message:secret,json:{error:{message:secret}},text:secret}),category:'api',status:403},
    {error:new APIError(Response.json({}), {message:'Response JSON is not valid: '+JSON.stringify([{path:['snapshots',0,'expiresAt'],message:secret},{path:[secret],message:secret}]),json:{secret},text:secret}),category:'response_schema',status:200},
    {error:Object.assign(new Error(secret),{name:'VercelOidcContextError'}),category:'credentials'},
    {error:new DOMException(secret,'TimeoutError'),category:'timeout'},
    {error:new TypeError('fetch failed'),category:'network'},
    {error:new TypeError(secret),category:'unknown'},
  ];
  const logs: unknown[][] = [];
  context.mock.method(console,'error',(...args:unknown[])=>{logs.push(args);});
  context.mock.method(Sandbox,'list',async()=>({toArray:async()=>[]}));
  for (const item of cases) {
    const mock = context.mock.method(Snapshot,'list',async()=>{throw item.error;});
    try {
      await assert.rejects(readSandboxInventory(), error=>{
        assert.ok(error instanceof SandboxInventoryError);
        assert.equal(error.diagnostic.phase,'snapshots');
        assert.equal(error.diagnostic.category,item.category);
        assert.equal(error.diagnostic.status,item.status);
        if(item.category==='response_schema')assert.deepEqual(error.diagnostic.fields,['snapshots.*.expiresAt','?']);
        assert.ok(!JSON.stringify(error).includes(secret));
        return true;
      });
    } finally {mock.mock.restore();}
  }
  assert.equal(logs.length,cases.length);
  assert.ok(!JSON.stringify(logs).includes(secret));
});
