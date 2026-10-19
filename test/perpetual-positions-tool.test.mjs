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

function tool(fetchStub, name = 'get-perpetual-positions') {
    const { allToolConfigs } = loadModule('tools/toolConfigs.ts', fetchStub);
    return allToolConfigs.find(config => config.name === name);
}

for (const resource of ['positions', 'trades']) {
    const name = `get-perpetual-${resource}`;
    test(`${name} exposes connected portfolios with read-only annotations`, () => {
        const config = tool(undefined, name);
        const schema = z.object(config.parameters);
        assert.equal(config.annotations.readOnlyHint, true);
        assert.equal(config.annotations.destructiveHint, false);
        assert.equal(config.annotations.openWorldHint, false);
        assert.deepEqual(Object.keys(config.parameters), resource === 'positions' ? ['portfolioId'] : ['portfolioId', 'limit', 'skip']);
        assert.equal(schema.safeParse({ portfolioId: 'portfolio-1' }).success, true);
        assert.equal(schema.safeParse({ portfolioId: '' }).success, false);
        assert.equal(schema.safeParse({ portfolioId: 'bad/value' }).success, false);
    });

    test(`${name} sends only connected selectors and preserves signed amounts`, async () => {
        const calls = [];
        const payload = { [resource]: [{ unrealizedPnlUsd: -200, fundingSinceOpenUsd: 3.5, realizedPnlUsd: -5, tradingFeeUsd: -0.2 }] };
        const fetchStub = async (url, options) => {
            calls.push({ url: new URL(url), options });
            return { ok: true, json: async () => payload };
        };
        const config = tool(fetchStub, name);
        const schema = z.object(config.parameters);
        const { invokeTool } = loadModule('tools/toolFactory.ts', fetchStub);
        const result = await invokeTool(config, schema.parse({ portfolioId: 'portfolio-1' }), 'test-token');
        assert.equal(calls[0].url.pathname, `/portfolio/perpetual/${resource}`);
        assert.equal(calls[0].url.searchParams.toString(), resource === 'positions' ? 'portfolioId=portfolio-1' : 'portfolioId=portfolio-1&limit=20&skip=0');
        assert.equal(calls[0].options.method, 'GET');
        assert.equal(calls[0].options.body, undefined);
        assert.equal(calls[0].options.headers['X-API-KEY'], 'test-token');
        assert.deepEqual(JSON.parse(result.content[0].text), payload);
        await invokeTool(config, schema.parse({}), 'test-token');
        assert.equal(calls[1].url.searchParams.has('portfolioId'), false);
    });

    test(`${name} surfaces upstream failures`, async () => {
        const fetchStub = async () => ({ ok: false, status: 502, text: async () => 'Exchange unavailable' });
        const { invokeTool } = loadModule('tools/toolFactory.ts', fetchStub);
        const result = await invokeTool(tool(fetchStub, name), {}, 'test-token');
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /502/);
    });
}

test('perpetual history validates bounded pagination', () => {
    const schema = z.object(tool(undefined, 'get-perpetual-trades').parameters);
    assert.deepEqual(schema.parse({}), { limit: 20, skip: 0 });
    for (const input of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { skip: -1 }, { skip: 10001 }]) {
        assert.equal(schema.safeParse(input).success, false);
    }
    assert.deepEqual(schema.parse({ limit: 10, skip: 20 }), { limit: 10, skip: 20 });
});
