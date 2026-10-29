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

async function fetchMirroredAuthorizationMetadata(pathname) {
    let upstreamUrl;
    const worker = loadWorker(async (url) => {
        upstreamUrl = String(url);
        return new Response(
            JSON.stringify({
                issuer: 'https://api.coin-stats.com',
                authorization_endpoint: 'https://coinstats.app/openapi/consent',
                token_endpoint: 'https://api.coin-stats.com/v1/oauth/token',
                scopes_supported: ['coinstats', 'admin'],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
    });

    const response = await worker.fetch(
        new Request(`https://mcp.coinstats.app${pathname}`),
        env
    );
    const body = await response.json();

    return { body, response, upstreamUrl };
}

test('mirrored authorization server metadata advertises the consumer MCP scope only', async () => {
    const paths = [
        '/.well-known/oauth-authorization-server',
        '/mcp/.well-known/oauth-authorization-server',
        '/.well-known/oauth-authorization-server/mcp',
    ];

    for (const pathname of paths) {
        const { body, response, upstreamUrl } =
            await fetchMirroredAuthorizationMetadata(pathname);

        assert.equal(response.status, 200);
        assert.equal(
            upstreamUrl,
            'https://api.coin-stats.com/.well-known/oauth-authorization-server'
        );
        assert.deepEqual(body.scopes_supported, ['coinstats']);
    }
});
