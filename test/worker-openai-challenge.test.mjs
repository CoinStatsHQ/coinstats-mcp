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

function loadWorker() {
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
        fetch: async () => {
            throw new Error('challenge route must not call upstream');
        },
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

const baseEnv = {
    OAUTH_ISSUER: 'https://api.coin-stats.com',
    MCP_RESOURCE_URL: 'https://mcp.coinstats.app',
};

const challengeUrl = 'https://mcp.coinstats.app/.well-known/openai-apps-challenge';

test('serves the configured OpenAI domain-verification token as bare plain text', async () => {
    const worker = loadWorker();
    const response = await worker.fetch(new Request(challengeUrl), {
        ...baseEnv,
        OPENAI_APPS_CHALLENGE: '  example-challenge-token\n',
    });

    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /^text\/plain/);
    assert.equal(await response.text(), 'example-challenge-token');
});

test('returns 404 for the challenge route when no token is configured', async () => {
    const worker = loadWorker();
    const response = await worker.fetch(new Request(challengeUrl), baseEnv);

    assert.equal(response.status, 404);
});
