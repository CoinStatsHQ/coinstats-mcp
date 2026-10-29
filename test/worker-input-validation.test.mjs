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

function transpile(file) {
    return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
}

/** The real tool catalogue, with real zod. */
function loadToolConfigs() {
    const file = path.join(repoRoot, 'src', 'tools', 'toolConfigs.ts');
    const moduleExports = {};
    const sandbox = {
        exports: moduleExports,
        module: { exports: moduleExports },
        require(specifier) {
            if (specifier === 'zod') return requireReal('zod');
            if (specifier === './toolFactory.js') return {};
            throw new Error(`Unexpected test import: ${specifier}`);
        },
    };
    vm.runInNewContext(transpile(file), sandbox, { filename: file });
    return sandbox.module.exports.allToolConfigs;
}

/**
 * Load worker.ts with real zod and the real catalogue, and a recording
 * `invokeTool`, so `tools/call` argument checks run as in production.
 */
function loadWorker(calls) {
    const workerPath = path.join(repoRoot, 'src', 'worker.ts');
    const allToolConfigs = loadToolConfigs();
    const moduleExports = {};
    const sandbox = {
        console,
        crypto: webcrypto,
        TextEncoder,
        Uint8Array,
        exports: moduleExports,
        Headers,
        module: { exports: moduleExports },
        Request,
        require(specifier) {
            if (specifier === 'zod' || specifier === 'zod-to-json-schema') return requireReal(specifier);
            if (specifier === './tools/toolConfigs.js') return { allToolConfigs };
            if (specifier === './tools/toolFactory.js') {
                return {
                    invokeTool: async (cfg, params) => {
                        // Copied out of the vm realm so deepEqual compares plain objects.
                        calls.push({ name: cfg.name, params: JSON.parse(JSON.stringify(params)) });
                        return { content: [{ type: 'text', text: '{}' }] };
                    },
                };
            }
            throw new Error(`Unexpected test import: ${specifier}`);
        },
        Response,
        URL,
    };
    vm.runInNewContext(transpile(workerPath), sandbox, { filename: workerPath });
    return sandbox.module.exports.default;
}

const env = { OAUTH_ISSUER: 'https://api.coin-stats.com', MCP_RESOURCE_URL: 'https://mcp.coinstats.app' };

async function callTool(name, args) {
    const calls = [];
    const worker = loadWorker(calls);
    const res = await worker.fetch(new Request('https://mcp.coinstats.app/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }), env);
    assert.equal(res.status, 200);
    return { body: await res.json(), calls };
}

test('invalid arguments are a tool error and never reach the API', async () => {
    for (const [name, args] of [
        ['get-market-insights', { insight: 'altcoin-season' }],
        ['get-market-insights', {}],
        ['get-news-by-type', { type: 'popular' }],
        ['search-prediction-markets', { q: 'b' }],
        ['get-prediction-events', { sort: 'spread' }],
    ]) {
        const { body, calls } = await callTool(name, args);
        assert.equal(body.result.isError, true, name);
        assert.match(body.result.content[0].text, /^Input validation error: Invalid arguments for tool /);
        assert.equal(calls.length, 0, name);
    }
});

test('valid arguments are forwarded as sent, without zod defaults', async () => {
    const { body, calls } = await callTool('get-wallet-transactions', { address: '0xabc', blockchain: 'ethereum' });
    assert.equal(body.result.isError, undefined);
    // page, limit and currency have zod defaults; the hosted server has never sent them.
    assert.deepEqual(calls, [{ name: 'get-wallet-transactions', params: { address: '0xabc', blockchain: 'ethereum' } }]);
});

test('wallet tools accept the API\'s alternative selectors', async () => {
    for (const [name, args] of [
        ['get-wallet-balances', { wallets: 'ethereum:0xabc,solana:5xyz' }],
        ['get-wallet-transactions', { wallets: 'ethereum:0xabc' }],
        ['get-portfolio-transactions', { portfolioId: 'p1', currency: 'USD', types: 'balance' }],
    ]) {
        const { body, calls } = await callTool(name, args);
        assert.equal(body.result.isError, undefined, name);
        assert.deepEqual(calls[0].params, args, name);
    }
});

test('unknown argument keys are dropped before the call', async () => {
    const { calls } = await callTool('get-prediction-market', { slug: 'will-btc-hit-100k', extra: 'x', constructor: 'x', toString: 'x' });
    assert.deepEqual(calls[0].params, { slug: 'will-btc-hit-100k' });
});
