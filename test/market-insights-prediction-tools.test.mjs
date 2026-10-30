import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requireReal = createRequire(import.meta.url);
const { z } = requireReal('zod');

// Exercise the actual catalogue, factory and HTTP adapter with only fetch replaced.
function loadModule(relativePath, fetchStub) {
    const file = path.join(repoRoot, 'src', relativePath);
    const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const exports = {};
    const sandbox = {
        exports, module: { exports }, console, URLSearchParams,
        fetch: fetchStub,
        require(specifier) {
            if (specifier.endsWith('/config/constants.js')) return { COINSTATS_API_BASE: 'https://api.example', COINSTATS_API_KEY: '' };
            if (specifier.startsWith('.')) {
                return loadModule(path.join(path.dirname(relativePath), specifier.replace(/\.js$/, '.ts')), fetchStub);
            }
            return requireReal(specifier);
        },
    };
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
}

async function call(name, params) {
    const calls = [];
    const fetchStub = async (url) => {
        calls.push(new URL(url));
        return { ok: true, json: async () => ({ ok: true }) };
    };
    const { allToolConfigs } = loadModule('tools/toolConfigs.ts', fetchStub);
    const { invokeTool } = loadModule('tools/toolFactory.ts', fetchStub);
    const config = allToolConfigs.find(c => c.name === name);
    const result = await invokeTool(config, params, 'token');
    assert.equal(result.isError, undefined);
    assert.equal(calls.length, 1);
    return calls[0];
}

const routes = [
    [{ insight: 'fear-and-greed' }, '/insights/fear-and-greed', {}],
    [{ insight: 'fear-and-greed-chart' }, '/insights/fear-and-greed/chart', {}],
    [{ insight: 'btc-dominance', type: '1w' }, '/insights/btc-dominance', { type: '1w' }],
    [{ insight: 'rainbow-chart', coinId: 'ethereum' }, '/insights/rainbow-chart/ethereum', {}],
];

for (const [params, pathname, query] of routes) {
    test(`get-market-insights routes ${params.insight} to ${pathname} without sending the selector`, async () => {
        const url = await call('get-market-insights', params);
        assert.equal(url.pathname, pathname);
        assert.deepEqual(Object.fromEntries(url.searchParams), query);
    });
}

test('get-market-insights errors on an unknown or missing indicator instead of calling another route', async () => {
    let called = false;
    const fetchStub = async () => { called = true; return { ok: true, json: async () => ({}) }; };
    const { allToolConfigs } = loadModule('tools/toolConfigs.ts', fetchStub);
    const { invokeTool } = loadModule('tools/toolFactory.ts', fetchStub);
    const config = allToolConfigs.find(c => c.name === 'get-market-insights');
    for (const params of [{ insight: 'altcoin-season' }, { insight: 'fear_and_greed' }, {}, { insight: 'constructor' }]) {
        const result = await invokeTool(config, params, 'token');
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /unknown insight/);
    }
    assert.equal(called, false);
});

test('get-market-insights only accepts known indicators', () => {
    const { allToolConfigs } = loadModule('tools/toolConfigs.ts');
    const schema = z.object(allToolConfigs.find(c => c.name === 'get-market-insights').parameters);
    assert.equal(schema.safeParse({ insight: 'fear-and-greed' }).success, true);
    assert.equal(schema.safeParse({ insight: 'altcoin-season' }).success, false);
    assert.equal(schema.safeParse({ insight: 'rainbow-chart', coinId: 'solana' }).success, false);
});

test('search-prediction-markets sends the query to /prediction/search', async () => {
    const url = await call('search-prediction-markets', { q: 'bitcoin', type: 'markets', limit: 5 });
    assert.equal(url.pathname, '/prediction/search');
    assert.deepEqual(Object.fromEntries(url.searchParams), { q: 'bitcoin', type: 'markets', limit: '5' });
});

test('get-prediction-markets passes sort and paging to /prediction/markets', async () => {
    const url = await call('get-prediction-markets', { sort: 'volume24hr', limit: 10, offset: 20 });
    assert.equal(url.pathname, '/prediction/markets');
    assert.deepEqual(Object.fromEntries(url.searchParams), { sort: 'volume24hr', limit: '10', offset: '20' });
});

test('get-prediction-events forwards the biggest-difference browse query', async () => {
    const query = { pairs: 'only', sort: 'gap', include: 'prices', category: 'politics', limit: 24 };
    const url = await call('get-prediction-events', query);
    assert.equal(url.pathname, '/prediction/events');
    assert.deepEqual(Object.fromEntries(url.searchParams), { ...query, limit: '24' });
});

test('get-prediction-market puts the encoded slug in the path', async () => {
    const url = await call('get-prediction-market', { slug: 'will-btc-hit-100k' });
    assert.equal(url.pathname, '/prediction/markets/will-btc-hit-100k');
    assert.equal(url.search, '');
});

test('prediction and insight tools are read-only and closed-world', () => {
    const { allToolConfigs } = loadModule('tools/toolConfigs.ts');
    for (const name of ['get-market-insights', 'search-prediction-markets', 'get-prediction-markets', 'get-prediction-events', 'get-prediction-market']) {
        const { annotations } = allToolConfigs.find(c => c.name === name);
        assert.equal(annotations.readOnlyHint, true, name);
        assert.equal(annotations.destructiveHint, false, name);
        assert.equal(annotations.openWorldHint, false, name);
    }
});
