import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const workerPath = path.join(repoRoot, 'src', 'worker.ts');

function loadWorker(fetchStub) {
    const source = fs.readFileSync(workerPath, 'utf8');
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
        crypto: { randomUUID: () => 'test-session-id' },
        exports: moduleExports,
        fetch: fetchStub,
        Headers,
        module: { exports: moduleExports },
        Request,
        require(specifier) {
            if (specifier === 'zod') return { z: { object: () => ({}) } };
            if (specifier === 'zod-to-json-schema') return { zodToJsonSchema: () => ({}) };
            if (specifier === './tools/toolConfigs.js') return { allToolConfigs: [] };
            if (specifier === './tools/toolFactory.js') return { invokeTool: async () => ({}) };
            throw new Error(`Unexpected test import: ${specifier}`);
        },
        Response,
        URL,
    };

    vm.runInNewContext(compiled, sandbox, { filename: workerPath });
    return sandbox.module.exports.default;
}

const env = {
    OAUTH_ISSUER: 'https://api.coin-stats.com',
    MCP_RESOURCE_URL: 'https://mcp.coinstats.app',
};

// GET /mcp is the Streamable-HTTP SSE upgrade. This server never pushes
// server-initiated messages, and the spec's answer for that is 405 — a
// 200 + instantly-closed event-stream reads to clients as a dropped
// connection and puts every connected agent into an infinite reconnect
// loop (~3.6M GETs/day observed against ~6k real POSTs).
test('GET /mcp returns 405 so clients stop opening SSE streams', async () => {
    const worker = loadWorker(async () => {
        throw new Error('no upstream fetch expected');
    });

    const response = await worker.fetch(
        new Request('https://mcp.coinstats.app/mcp', { method: 'GET' }),
        env
    );

    assert.equal(response.status, 405);
    assert.match(response.headers.get('Allow'), /POST/);
});

test('GET /mcp does not demand auth before rejecting the method', async () => {
    const worker = loadWorker(async () => {
        throw new Error('no upstream fetch expected');
    });

    // No Authorization header on purpose: a 401 here would send clients into
    // an OAuth retry flow for a method the server does not support at all.
    const response = await worker.fetch(
        new Request('https://mcp.coinstats.app/mcp', { method: 'GET' }),
        env
    );

    assert.equal(response.status, 405);
    assert.equal(response.headers.get('WWW-Authenticate'), null);
});

test('DELETE /mcp still acknowledges session termination with 204', async () => {
    const worker = loadWorker(async () => {
        throw new Error('no upstream fetch expected');
    });

    const response = await worker.fetch(
        new Request('https://mcp.coinstats.app/mcp', { method: 'DELETE' }),
        env
    );

    assert.equal(response.status, 204);
});

test('other /mcp methods get 405 with an Allow header', async () => {
    const worker = loadWorker(async () => {
        throw new Error('no upstream fetch expected');
    });

    const response = await worker.fetch(
        new Request('https://mcp.coinstats.app/mcp', { method: 'PUT' }),
        env
    );

    assert.equal(response.status, 405);
    assert.match(response.headers.get('Allow'), /POST/);
});
