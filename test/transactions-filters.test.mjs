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

const ADDRESS = '0x0000000000000000000000000000000000000001';

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

function tool(name, fetchStub) {
    const { allToolConfigs } = loadModule('tools/toolConfigs.ts', fetchStub);
    return allToolConfigs.find(config => config.name === name);
}

function recordingFetch(calls) {
    return async (url, options) => {
        calls.push({ url: new URL(url), options });
        return { ok: true, json: async () => ({ result: [], meta: { page: 1, limit: 20 } }) };
    };
}

test('get-wallet-transactions accepts coinId and both spam filters, and caps limit at 200', () => {
    const schema = z.object(tool('get-wallet-transactions').parameters);
    const base = { address: ADDRESS, connectionId: 'ethereum' };

    assert.equal(schema.safeParse({ ...base, coinId: 'usd-coin', hideUnidentifiedCoins: true, excludeDetectedSpam: true }).success, true);
    assert.equal(schema.safeParse({ ...base, limit: 200 }).success, true);
    assert.equal(schema.safeParse({ ...base, limit: 201 }).success, false);
    assert.equal(schema.safeParse({ ...base, limit: 0 }).success, false);
    assert.equal(schema.safeParse({ ...base, excludeDetectedSpam: 'yes' }).success, false);
    assert.equal(schema.safeParse({ ...base, hideUnidentifiedCoins: 'yes' }).success, false);
});

test('get-wallet-transactions names the sync tool instead of a REST route', () => {
    const { description } = tool('get-wallet-transactions');
    assert.doesNotMatch(description, /PATCH/);
    assert.match(description, /transactions-sync/);
    assert.match(description, /get-wallet-sync-status/);
});

test('get-wallet-transactions sends the filters as query parameters only when given', async () => {
    const calls = [];
    const fetchStub = recordingFetch(calls);
    const config = tool('get-wallet-transactions', fetchStub);
    const schema = z.object(config.parameters);
    const { invokeTool } = loadModule('tools/toolFactory.ts', fetchStub);

    await invokeTool(config, schema.parse({ address: ADDRESS, connectionId: 'ethereum' }), 'test-token');
    const plain = calls[0].url.searchParams;
    assert.equal(calls[0].url.pathname, '/wallet/transactions');
    assert.equal(plain.has('coinId'), false);
    assert.equal(plain.has('hideUnidentifiedCoins'), false);
    assert.equal(plain.has('excludeDetectedSpam'), false);

    await invokeTool(
        config,
        schema.parse({ address: ADDRESS, connectionId: 'ethereum', coinId: 'usd-coin', hideUnidentifiedCoins: true, excludeDetectedSpam: true, limit: 200 }),
        'test-token',
    );
    const filtered = calls[1].url.searchParams;
    assert.equal(filtered.get('coinId'), 'usd-coin');
    assert.equal(filtered.get('hideUnidentifiedCoins'), 'true');
    assert.equal(filtered.get('excludeDetectedSpam'), 'true');
    assert.equal(filtered.get('limit'), '200');
    assert.equal(calls[1].options.method, 'GET');
});

test('get-portfolio-transactions forwards both spam filters', async () => {
    const calls = [];
    const fetchStub = recordingFetch(calls);
    const config = tool('get-portfolio-transactions', fetchStub);
    const schema = z.object(config.parameters);
    const { invokeTool } = loadModule('tools/toolFactory.ts', fetchStub);

    assert.equal(schema.safeParse({ currency: 'USD', excludeDetectedSpam: 'yes' }).success, false);

    await invokeTool(config, schema.parse({ currency: 'USD', hideUnidentifiedCoins: true, excludeDetectedSpam: true }), 'test-token');
    const params = calls[0].url.searchParams;
    assert.equal(calls[0].url.pathname, '/portfolio/transactions');
    assert.equal(params.get('hideUnidentifiedCoins'), 'true');
    assert.equal(params.get('excludeDetectedSpam'), 'true');
});
