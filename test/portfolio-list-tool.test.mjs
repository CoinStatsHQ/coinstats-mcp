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

function tool(fetchStub, name = 'get-portfolio-list') {
    const { allToolConfigs } = loadModule('tools/toolConfigs.ts', fetchStub);
    return allToolConfigs.find(config => config.name === name);
}


test('get-portfolio-list stays read-only and takes an optional boolean includeChildren', () => {
    const config = tool();
    const schema = z.object(config.parameters);
    assert.equal(config.annotations.readOnlyHint, true);
    assert.equal(config.annotations.openWorldHint, false);
    assert.deepEqual(Object.keys(config.parameters), ['includeChildren']);
    assert.equal(schema.safeParse({}).success, true);
    assert.equal(schema.safeParse({ includeChildren: true }).success, true);
    assert.equal(schema.safeParse({ includeChildren: 'yes' }).success, false);
});

test('get-portfolio-list sends includeChildren only when requested', async () => {
    const calls = [];
    const payload = { result: [{ portfolioId: 'parent-1', portfolioName: 'Parent', portfolioType: 'parent', children: [] }] };
    const fetchStub = async (url, options) => {
        calls.push({ url: new URL(url), options });
        return { ok: true, json: async () => payload };
    };
    const config = tool(fetchStub);
    const schema = z.object(config.parameters);
    const { invokeTool } = loadModule('tools/toolFactory.ts', fetchStub);

    await invokeTool(config, schema.parse({}), 'test-token');
    assert.equal(calls[0].url.pathname, '/portfolio/list');
    assert.equal(calls[0].url.searchParams.toString(), '');

    const result = await invokeTool(config, schema.parse({ includeChildren: true }), 'test-token');
    assert.equal(calls[1].url.searchParams.toString(), 'includeChildren=true');
    assert.equal(calls[1].options.method, 'GET');
    assert.deepEqual(JSON.parse(result.content[0].text), payload);
});
