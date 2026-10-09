import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requestPath = path.join(__dirname, '..', 'src', 'services', 'request.ts');

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

// Exact body public-api-v2's InvalidApiKeyException produces.
const INVALID_KEY_BODY = JSON.stringify({
    statusCode: 401,
    message: 'Your API Key is invalid. Please login to https://openapi.coinstats.app and generate your API Key.',
});

function respond(status, text) {
    return async () => ({ ok: status >= 200 && status < 300, status, statusText: 'x', text: async () => text, json: async () => JSON.parse(text) });
}

test('401 "API Key is invalid" rejects with an invalid-token CoinStatsApiError', async () => {
    const { universalApiHandler } = loadRequest(respond(401, INVALID_KEY_BODY));
    await assert.rejects(
        () => universalApiHandler('https://api.example', '/portfolio/coins', 'GET', {}, undefined, 'tok'),
        (err) => {
            assert.equal(err.name, 'CoinStatsApiError');
            assert.equal(err.status, 401);
            assert.equal(err.isInvalidToken, true);
            assert.match(err.message, /CoinStats API error 401/);
            return true;
        }
    );
});

test('a 401 with any other body stays a tool error (downstream pass-through 401s)', async () => {
    const { universalApiHandler } = loadRequest(respond(401, '{"statusCode":401,"message":"Exchange credentials expired"}'));
    const res = await universalApiHandler('https://api.example', '/exchange/balance', 'GET', {}, undefined, 'tok');
    assert.equal(res.isError, true);
    assert.equal(res.content[0].isError, true);
    assert.match(res.content[0].text, /401/);
});

for (const status of [402, 403, 406, 429, 500, 501]) {
    test(`${status} stays a tool error with result-level isError`, async () => {
        const { universalApiHandler } = loadRequest(respond(status, `{"statusCode":${status},"message":"nope"}`));
        const res = await universalApiHandler('https://api.example', '/coins', 'GET', {}, undefined, 'tok');
        assert.equal(res.isError, true);
        assert.equal(res.content[0].isError, true);
        assert.match(res.content[0].text, new RegExp(`CoinStats API error ${status}`));
    });
}

test('network failure stays a tool error', async () => {
    const { universalApiHandler } = loadRequest(async () => {
        throw new Error('fetch failed');
    });
    const res = await universalApiHandler('https://api.example', '/coins', 'GET', {}, undefined, 'tok');
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /fetch failed/);
});

test('success has no isError flag', async () => {
    const { universalApiHandler } = loadRequest(respond(200, '{"result":[1]}'));
    const res = await universalApiHandler('https://api.example', '/coins', 'GET', {}, undefined, 'tok');
    assert.equal(res.isError, undefined);
    assert.equal(res.content[0].text, '{"result":[1]}');
});
