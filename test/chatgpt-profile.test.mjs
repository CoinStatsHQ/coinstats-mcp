import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const requireReal = createRequire(path.join(repoRoot, 'package.json'));

function loadModule(relPath, requireStub, extraGlobals = {}) {
    const file = path.join(repoRoot, relPath);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const moduleExports = {};
    const sandbox = { exports: moduleExports, module: { exports: moduleExports }, require: requireStub, ...extraGlobals };
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
}

const toolConfigs = loadModule('src/tools/toolConfigs.ts', (s) => {
    if (s === 'zod') return requireReal('zod');
    throw new Error(`Unexpected import in toolConfigs: ${s}`);
});
const profiles = loadModule('src/tools/profiles.ts', (s) => {
    if (s === 'zod') return requireReal('zod');
    if (s === './toolConfigs.js') return toolConfigs;
    throw new Error(`Unexpected import in profiles: ${s}`);
});

/** Worker over the real profiles; `calls` records every tool invocation that reaches the API layer. */
function loadWorker() {
    const calls = [];
    const worker = loadModule(
        'src/worker.ts',
        (s) => {
            if (s === 'zod') return requireReal('zod');
            if (s === 'zod-to-json-schema') return requireReal('zod-to-json-schema');
            if (s === './tools/profiles.js') return profiles;
            if (s === './tools/toolFactory.js') {
                return {
                    invokeTool: async (cfg, args) => {
                        calls.push({ name: cfg.name, args: { ...args } });
                        return { content: [{ type: 'text', text: '[]' }] };
                    },
                };
            }
            throw new Error(`Unexpected import in worker: ${s}`);
        },
        { console, crypto: webcrypto, TextEncoder, Uint8Array, fetch: async () => { throw new Error('unexpected fetch'); }, Headers, Request, Response, URL }
    ).default;
    return { worker, calls };
}

const env = { OAUTH_ISSUER: 'https://auth.example', MCP_RESOURCE_URL: 'https://mcp.example' };

function rpc(worker, pathName, method, params) {
    return worker.fetch(
        new Request(`https://mcp.example${pathName}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
        env
    );
}

const listNames = async (worker, p) => Array.from((await (await rpc(worker, p, 'tools/list')).json()).result.tools, (t) => t.name);

test('/chatgpt/mcp lists every tool except the excluded ones', async () => {
    const { worker } = loadWorker();
    const all = await listNames(worker, '/mcp');
    const chatgpt = await listNames(worker, '/chatgpt/mcp');
    const excluded = Array.from(profiles.CHATGPT_EXCLUDED_TOOLS);
    for (const name of excluded) assert.ok(all.includes(name), `${name} should still be on /mcp`);
    assert.deepEqual(chatgpt, all.filter((n) => !excluded.includes(n)));
});

test('/mcp still serves the full catalogue unchanged', async () => {
    const { worker } = loadWorker();
    assert.deepEqual(await listNames(worker, '/mcp'), Array.from(toolConfigs.allToolConfigs, (c) => c.name));
});

test('excluded tools are rejected on /chatgpt/mcp tools/call and never invoked', async () => {
    const { worker, calls } = loadWorker();
    for (const name of profiles.CHATGPT_EXCLUDED_TOOLS) {
        const body = await (await rpc(worker, '/chatgpt/mcp', 'tools/call', { name, arguments: {} })).json();
        assert.equal(body.error?.code, -32601, name);
    }
    assert.equal(calls.length, 0);
});

test('no ChatGPT tool text points at an excluded tool', async () => {
    const { worker } = loadWorker();
    const { tools } = (await (await rpc(worker, '/chatgpt/mcp', 'tools/list')).json()).result;
    const text = JSON.stringify(tools);
    for (const name of profiles.CHATGPT_EXCLUDED_TOOLS) assert.ok(!text.includes(name), `mentions ${name}`);
    for (const cfg of profiles.CHATGPT_PROFILE.tools) {
        if (cfg.emptyGuidance) assert.ok(!cfg.emptyGuidance.includes('connect-portfolio-exchange'), cfg.name);
    }
});

test('get-coins advertises only the trimmed inputs on /chatgpt/mcp', async () => {
    const { worker } = loadWorker();
    const { tools } = (await (await rpc(worker, '/chatgpt/mcp', 'tools/list')).json()).result;
    const props = Object.keys(tools.find((t) => t.name === 'get-coins').inputSchema.properties).sort();
    assert.deepEqual(props, ['blockchains', 'categories', 'currency', 'limit', 'name', 'page', 'sortBy', 'sortDir', 'symbol']);
});

test('strict arguments: unknown inputs are dropped before the API call', async () => {
    const { worker, calls } = loadWorker();
    const res = await rpc(worker, '/chatgpt/mcp', 'tools/call', {
        name: 'get-coins',
        arguments: { name: 'bitcoin', 'price-greaterThan': 10, conversation: 'everything said so far' },
    });
    assert.equal((await res.json()).result !== undefined, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.name, 'bitcoin');
    assert.equal('price-greaterThan' in calls[0].args, false);
    assert.equal('conversation' in calls[0].args, false);
});

test('strict arguments: invalid values are rejected with -32602', async () => {
    const { worker, calls } = loadWorker();
    const body = await (await rpc(worker, '/chatgpt/mcp', 'tools/call', { name: 'get-coins', arguments: { page: 'two' } })).json();
    assert.equal(body.error?.code, -32602);
    assert.match(body.error.message, /page/);
    assert.equal(calls.length, 0);
});

test('search-prediction-markets never asks for traders on /chatgpt/mcp', async () => {
    const { worker, calls } = loadWorker();
    const traders = await (await rpc(worker, '/chatgpt/mcp', 'tools/call', { name: 'search-prediction-markets', arguments: { q: 'bitcoin', type: 'traders' } })).json();
    assert.equal(traders.error?.code, -32602);
    await rpc(worker, '/chatgpt/mcp', 'tools/call', { name: 'search-prediction-markets', arguments: { q: 'bitcoin' } });
    assert.equal(calls.at(-1).args.type, 'markets');
});

test('/mcp keeps forwarding arguments as sent', async () => {
    const { worker, calls } = loadWorker();
    await rpc(worker, '/mcp', 'tools/call', { name: 'get-coins', arguments: { 'price-greaterThan': 10 } });
    assert.equal(calls.at(-1).args['price-greaterThan'], 10);
});

test('protected-resource metadata is served for the ChatGPT path', async () => {
    const { worker } = loadWorker();
    const res = await worker.fetch(new Request('https://mcp.example/.well-known/oauth-protected-resource/chatgpt/mcp'), env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.resource, 'https://mcp.example/chatgpt/mcp');
    assert.deepEqual(Array.from(body.scopes_supported), ['coinstats']);
});

test('/chatgpt/mcp without a bearer gets the same 401 challenge', async () => {
    const { worker } = loadWorker();
    const res = await worker.fetch(
        new Request('https://mcp.example/chatgpt/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
        env
    );
    assert.equal(res.status, 401);
    assert.match(res.headers.get('WWW-Authenticate'), /resource_metadata="https:\/\/mcp\.example\/\.well-known\/oauth-protected-resource"/);
});
