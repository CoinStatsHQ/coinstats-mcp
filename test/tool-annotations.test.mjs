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

/** Load the real tool catalogue (toolFactory is imported for types only). */
function loadToolConfigs() {
    const file = path.join(repoRoot, 'src', 'tools', 'toolConfigs.ts');
    const moduleExports = {};
    const sandbox = {
        exports: moduleExports,
        module: { exports: moduleExports },
        require(specifier) {
            if (specifier === 'zod') return requireReal('zod');
            throw new Error(`Unexpected test import: ${specifier}`);
        },
    };
    vm.runInNewContext(transpile(file), sandbox, { filename: file });
    return sandbox.module.exports.allToolConfigs;
}

/** Load worker.ts over the real catalogue so tools/list output is what clients see. */
function loadWorker(allToolConfigs) {
    const file = path.join(repoRoot, 'src', 'worker.ts');
    const moduleExports = {};
    const sandbox = {
        console,
        crypto: webcrypto,
        TextEncoder,
        Uint8Array,
        exports: moduleExports,
        fetch: async () => { throw new Error('unexpected fetch'); },
        Headers,
        module: { exports: moduleExports },
        Request,
        require(specifier) {
            if (specifier === 'zod') return requireReal('zod');
            if (specifier === 'zod-to-json-schema') return requireReal('zod-to-json-schema');
            if (specifier === './tools/toolConfigs.js') return { allToolConfigs };
            if (specifier === './tools/toolFactory.js') return { invokeTool: async () => ({ content: [] }) };
            throw new Error(`Unexpected test import: ${specifier}`);
        },
        Response,
        URL,
    };
    vm.runInNewContext(transpile(file), sandbox, { filename: file });
    return sandbox.module.exports.default;
}

const HINTS = ['readOnlyHint', 'destructiveHint', 'openWorldHint'];
const WRITE_TOOLS = ['sync-portfolio', 'transactions-sync', 'connect-portfolio-wallet', 'add-portfolio-transaction'];
// get-exchange-balance connects the exchange on first use, and both exchange
// tools rename an existing connection when given a different name.
const DESTRUCTIVE_TOOLS = ['delete-portfolio', 'connect-portfolio-exchange', 'get-exchange-balance'];

const configs = loadToolConfigs();
const byName = Object.fromEntries(configs.map((c) => [c.name, c]));

test('every tool declares a title and all three hints as booleans', () => {
    assert.ok(configs.length >= 38);
    for (const c of configs) {
        assert.equal(typeof c.annotations?.title, 'string', `${c.name} title`);
        assert.ok(c.annotations.title.trim().length > 0, `${c.name} title is empty`);
        for (const h of HINTS) assert.equal(typeof c.annotations[h], 'boolean', `${c.name} ${h}`);
    }
});

test('titles are unique', () => {
    const titles = configs.map((c) => c.annotations.title);
    assert.equal(new Set(titles).size, titles.length);
});

test('get-* tools are read-only and never destructive (except get-exchange-balance)', () => {
    for (const c of configs.filter((c) => c.name.startsWith('get-') && !DESTRUCTIVE_TOOLS.includes(c.name))) {
        assert.equal(c.annotations.readOnlyHint, true, c.name);
        assert.equal(c.annotations.destructiveHint, false, c.name);
    }
});

test('write tools are not read-only and are additive', () => {
    for (const name of WRITE_TOOLS) {
        assert.equal(byName[name].annotations.readOnlyHint, false, name);
        assert.equal(byName[name].annotations.destructiveHint, false, name);
    }
});

test('delete-portfolio and the exchange-connecting tools are destructive', () => {
    for (const name of DESTRUCTIVE_TOOLS) {
        assert.equal(byName[name].annotations.readOnlyHint, false, name);
        assert.equal(byName[name].annotations.destructiveHint, true, name);
    }
});

test('exactly the listed tools are writes; everything else is read-only', () => {
    // Array.from: configs comes from a vm context, and deepEqual compares prototypes across realms.
    const writes = Array.from(configs.filter((c) => !c.annotations.readOnlyHint), (c) => c.name).sort();
    assert.deepEqual(writes, [...WRITE_TOOLS, ...DESTRUCTIVE_TOOLS].sort());
});

test('tools/list emits title and annotations for every tool', async () => {
    const worker = loadWorker(configs);
    const req = new Request('https://mcp.coinstats.app/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    const res = await worker.fetch(req, { OAUTH_ISSUER: 'https://api.coin-stats.com', MCP_RESOURCE_URL: 'https://mcp.coinstats.app' });
    assert.equal(res.status, 200);
    const { result } = await res.json();
    assert.equal(result.tools.length, configs.length);
    for (const tool of result.tools) {
        const expected = byName[tool.name].annotations;
        assert.equal(tool.title, expected.title, tool.name);
        assert.deepEqual({ ...tool.annotations }, { ...expected }, tool.name);
    }
});
