import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const factoryPath = path.join(repoRoot, 'src', 'tools', 'toolFactory.ts');

/**
 * Load toolFactory.ts in an isolated VM with its module imports stubbed.
 * `universalApiHandlerStub` stands in for the network layer so we can drive
 * invokeTool with controlled payloads and assert the empty-guidance logic.
 */
function loadFactory(universalApiHandlerStub) {
    const source = fs.readFileSync(factoryPath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
    }).outputText;

    const moduleExports = {};
    const sandbox = {
        console,
        exports: moduleExports,
        module: { exports: moduleExports },
        require(specifier) {
            if (specifier === 'zod') return { z: {} };
            if (specifier === '@modelcontextprotocol/sdk/server/mcp.js') return { McpServer: class {} };
            if (specifier === '../services/request.js') return { universalApiHandler: universalApiHandlerStub };
            if (specifier === '../config/constants.js') return { COINSTATS_API_BASE: 'https://api.example' };
            if (specifier === '../utils/cache.js') return { saveToCache: async () => {}, getFromCache: async () => undefined };
            throw new Error(`Unexpected test import: ${specifier}`);
        },
    };

    vm.runInNewContext(compiled, sandbox, { filename: factoryPath });
    return sandbox.module.exports;
}

const GUIDANCE = 'Provide a shareToken or connect a portfolio.';
const readConfig = {
    name: 'get-portfolio-coins',
    description: 'x',
    endpoint: '/portfolio/coins',
    method: 'GET',
    emptyGuidance: GUIDANCE,
    parameters: {},
};

function stubReturning(payload) {
    return async () => ({ content: [{ type: 'text', text: JSON.stringify(payload) }] });
}

test('empty payload + no selector returns the guidance message', async () => {
    const { invokeTool } = loadFactory(stubReturning({ result: [] }));
    const res = await invokeTool(readConfig, {}, 'tok');
    assert.equal(res.content[0].text, GUIDANCE);
});

test('non-empty payload returns data, not guidance', async () => {
    const payload = [{ coinId: 'bitcoin', amount: 1 }];
    const { invokeTool } = loadFactory(stubReturning(payload));
    const res = await invokeTool(readConfig, {}, 'tok');
    assert.equal(res.content[0].text, JSON.stringify(payload));
});

test('empty payload but a selector was provided returns data, not guidance', async () => {
    const { invokeTool } = loadFactory(stubReturning({ result: [] }));
    const withShare = await invokeTool(readConfig, { shareToken: 'abc' }, 'tok');
    assert.equal(withShare.content[0].text, JSON.stringify({ result: [] }));
    const withId = await invokeTool(readConfig, { portfolioId: 'p1' }, 'tok');
    assert.equal(withId.content[0].text, JSON.stringify({ result: [] }));
});

test('config without emptyGuidance never substitutes', async () => {
    const { invokeTool } = loadFactory(stubReturning([]));
    const cfg = { ...readConfig, emptyGuidance: undefined };
    const res = await invokeTool(cfg, {}, 'tok');
    assert.equal(res.content[0].text, JSON.stringify([]));
});

function capturingStub() {
    const calls = [];
    const stub = async (...args) => {
        calls.push(args);
        return { content: [{ type: 'text', text: '{"ok":true}' }] };
    };
    return { stub, calls };
}

test('paramsInQuery routes params to the query string, not the body', async () => {
    const { stub, calls } = capturingStub();
    const { invokeTool } = loadFactory(stub);
    const cfg = { name: 'sync-portfolio', description: 'x', endpoint: '/portfolio/sync', method: 'PATCH', paramsInQuery: true, parameters: {} };
    await invokeTool(cfg, { portfolioId: 'p1' }, 'tok');
    // universalApiHandler(basePath, endpoint, method, queryParams, body, token)
    const [, endpoint, method, queryParams, body] = calls[0];
    assert.equal(endpoint, '/portfolio/sync');
    assert.equal(method, 'PATCH');
    assert.deepEqual(queryParams, { portfolioId: 'p1' });
    assert.equal(body, undefined);
});

test('body methods without paramsInQuery still send params in the body', async () => {
    const { stub, calls } = capturingStub();
    const { invokeTool } = loadFactory(stub);
    const cfg = { name: 'connect-portfolio-wallet', description: 'x', endpoint: '/portfolio/wallet', method: 'POST', parameters: {} };
    await invokeTool(cfg, { address: '0xabc', connectionId: 'ethereum' }, 'tok');
    const [, , , queryParams, body] = calls[0];
    // queryParams is created inside the VM sandbox (different realm), so check
    // its emptiness by key count rather than cross-realm deepStrictEqual.
    assert.equal(Object.keys(queryParams).length, 0);
    assert.deepEqual(body, { address: '0xabc', connectionId: 'ethereum' });
});

test('isEmptyPayload recognizes empty shapes and ignores errors', async () => {
    const { isEmptyPayload } = loadFactory(stubReturning({}));
    const empty = (text, isError = false) => isEmptyPayload({ content: [{ type: 'text', text, isError }] });
    assert.equal(empty('[]'), true);
    assert.equal(empty('{}'), true);
    assert.equal(empty('{"result":[]}'), true);
    assert.equal(empty('{"result":null}'), true);
    assert.equal(empty('{"data":[]}'), true);
    assert.equal(empty('[{"a":1}]'), false);
    assert.equal(empty('{"result":[{"a":1}]}'), false);
    assert.equal(empty('Error: boom', true), false);
    assert.equal(empty('not json'), false);
});
