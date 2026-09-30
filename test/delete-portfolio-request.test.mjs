import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requestPath = path.join(__dirname, '..', 'src', 'services', 'request.ts');

/**
 * Load request.ts with a fake `fetch` so we can assert the exact URL and
 * options a tool call produces, without touching the network.
 */
function loadRequest(fetchStub) {
    const compiled = ts.transpileModule(fs.readFileSync(requestPath, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;

    const moduleExports = {};
    const sandbox = {
        console,
        URLSearchParams,
        fetch: fetchStub,
        exports: moduleExports,
        module: { exports: moduleExports },
        require(specifier) {
            if (specifier === '../config/constants.js') return { COINSTATS_API_KEY: undefined };
            throw new Error(`Unexpected test import: ${specifier}`);
        },
    };
    vm.runInNewContext(compiled, sandbox, { filename: requestPath });
    return sandbox.module.exports;
}

test('delete-portfolio substitutes portfolioId into the path and sends no query or body', async () => {
    const calls = [];
    const { universalApiHandler } = loadRequest(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({ message: 'Portfolio deleted successfully' }) };
    });

    // Same call shape invokeTool makes for a DELETE tool with paramsInQuery: params as query, no body.
    await universalApiHandler('https://api.example', '/portfolio/{portfolioId}', 'DELETE', { portfolioId: 'p1' }, undefined, 'tok');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example/portfolio/p1');
    assert.equal(calls[0].options.method, 'DELETE');
    assert.equal(calls[0].options.body, undefined);
    assert.equal(calls[0].options.headers['X-API-KEY'], 'tok');
});

test('path params are URL-encoded so they cannot inject query params or path segments', async () => {
    const calls = [];
    const { universalApiHandler } = loadRequest(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({}) };
    });

    await universalApiHandler(
        'https://api.example',
        '/portfolio/{portfolioId}',
        'DELETE',
        { portfolioId: 'VICTIM?userId=VICTIM_UID&x=/../#' },
        undefined,
        'tok'
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.example/portfolio/VICTIM%3FuserId%3DVICTIM_UID%26x%3D%2F..%2F%23');
});

test('path param substitution does not expand $& / $` replacement patterns', async () => {
    const calls = [];
    const { universalApiHandler } = loadRequest(async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => ({}) };
    });

    await universalApiHandler('https://api.example', '/coins/{coinId}', 'GET', { coinId: "$&$`$'" }, undefined, 'tok');

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://api.example/coins/${encodeURIComponent("$&$`$'")}`);
});
