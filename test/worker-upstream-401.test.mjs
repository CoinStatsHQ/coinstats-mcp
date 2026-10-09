import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(__dirname, '..', 'src', 'worker.ts');

/**
 * Load worker.ts with a stubbed tool catalogue (one tool named `t`) and a
 * controllable `invokeTool`, so POST /mcp can be driven end to end.
 * Real Web Crypto/`TextEncoder` are passed through for `hashUser`.
 */
function loadWorker({ invokeTool, fetchStub = async () => { throw new Error('unexpected fetch'); } }) {
    const compiled = ts.transpileModule(fs.readFileSync(workerPath, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;

    const moduleExports = {};
    const sandbox = {
        console,
        // Explicit import: `globalThis.crypto` isn't there on Node 18 (engines: >=18).
        crypto: webcrypto,
        TextEncoder,
        Uint8Array,
        exports: moduleExports,
        fetch: fetchStub,
        Headers,
        module: { exports: moduleExports },
        Request,
        require(specifier) {
            if (specifier === 'zod') return { z: { object: () => ({}) } };
            if (specifier === 'zod-to-json-schema') return { zodToJsonSchema: () => ({}) };
            if (specifier === './tools/toolConfigs.js') return { allToolConfigs: [{ name: 't', description: 'd', parameters: {} }] };
            if (specifier === './tools/toolFactory.js') return { invokeTool };
            throw new Error(`Unexpected test import: ${specifier}`);
        },
        Response,
        URL,
    };
    vm.runInNewContext(compiled, sandbox, { filename: workerPath });
    return sandbox.module.exports.default;
}

const env = { OAUTH_ISSUER: 'https://api.coin-stats.com', MCP_RESOURCE_URL: 'https://mcp.coinstats.app' };

function post(body, { auth = 'Bearer tok' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (auth) headers.Authorization = auth;
    return new Request('https://mcp.coinstats.app/mcp', { method: 'POST', headers, body: JSON.stringify(body) });
}

const call = (id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 't', arguments: {} } });

function invalidTokenError() {
    return Object.assign(new Error('CoinStats API error 401: invalid'), {
        name: 'CoinStatsApiError',
        status: 401,
        isInvalidToken: true,
    });
}

function assert401Challenge(res) {
    assert.equal(res.status, 401);
    const www = res.headers.get('WWW-Authenticate');
    assert.match(www, /^Bearer /);
    assert.match(www, /error="invalid_token"/);
    assert.match(www, /scope="coinstats"/);
    assert.match(www, /resource_metadata="https:\/\/mcp\.coinstats\.app\/\.well-known\/oauth-protected-resource"/);
    assert.match(res.headers.get('Access-Control-Expose-Headers'), /WWW-Authenticate/);
}

test('tools/call with a dead token answers HTTP 401 + WWW-Authenticate', async () => {
    const worker = loadWorker({ invokeTool: async () => { throw invalidTokenError(); } });
    const res = await worker.fetch(post(call()), env);
    assert401Challenge(res);
    const body = await res.json();
    assert.equal(body.error, 'invalid_token');
});

test('a batch containing one dead-token call is a 401 as a whole', async () => {
    const worker = loadWorker({ invokeTool: async () => { throw invalidTokenError(); } });
    const res = await worker.fetch(post([call(1), { jsonrpc: '2.0', id: 2, method: 'ping' }]), env);
    assert401Challenge(res);
});

test('other tool failures stay JSON-RPC errors over HTTP 200', async () => {
    const worker = loadWorker({ invokeTool: async () => { throw new Error('boom'); } });
    const res = await worker.fetch(post(call()), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.error.code, -32000);
    assert.match(body.error.message, /boom/);
});

test('a 401 that is not an invalid-token error is not mapped to HTTP 401', async () => {
    const err = Object.assign(new Error('CoinStats API error 401: downstream'), { name: 'CoinStatsApiError', status: 401, isInvalidToken: false });
    const worker = loadWorker({ invokeTool: async () => { throw err; } });
    const res = await worker.fetch(post(call()), env);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).error.code, -32000);
});

test('tool errors returned as results pass through with result-level isError', async () => {
    const worker = loadWorker({
        invokeTool: async () => ({ isError: true, content: [{ type: 'text', text: 'Error: 429', isError: true }] }),
    });
    const res = await worker.fetch(post(call()), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.result.isError, true);
});

test('initialize and tools/list do not call upstream, even with a garbage bearer', async () => {
    let invoked = 0;
    const worker = loadWorker({ invokeTool: async () => { invoked++; return { content: [] }; } });
    for (const method of ['initialize', 'tools/list']) {
        const res = await worker.fetch(post({ jsonrpc: '2.0', id: 1, method, params: {} }, { auth: 'Bearer garbage' }), env);
        assert.equal(res.status, 200, method);
    }
    assert.equal(invoked, 0);
});

test('missing bearer is still a 401', async () => {
    const worker = loadWorker({ invokeTool: async () => ({ content: [] }) });
    const res = await worker.fetch(post(call(), { auth: null }), env);
    assert401Challenge(res);
});

test('dead-token calls are recorded as errors in analytics', async () => {
    const points = [];
    const worker = loadWorker({ invokeTool: async () => { throw invalidTokenError(); } });
    await worker.fetch(post(call()), { ...env, MCP_AE: { writeDataPoint: (p) => points.push(p) } });
    assert.equal(points.length, 1);
    assert.equal(points[0].blobs[0], 't');
    assert.equal(points[0].blobs[3], 'error');
});
