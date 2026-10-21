import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const configsPath = path.join(repoRoot, 'src', 'tools', 'toolConfigs.ts');
const require = createRequire(import.meta.url);

function loadToolConfigs() {
    const source = fs.readFileSync(configsPath, 'utf8');
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
            if (specifier === 'zod') return require('zod');
            if (specifier === './toolFactory.js') return {};
            throw new Error(`Unexpected test import: ${specifier}`);
        },
    };

    vm.runInNewContext(compiled, sandbox, { filename: configsPath });
    return sandbox.module.exports.allToolConfigs;
}

const expectedTools = [
    ['get-wallet-pl-history', '/wallet/pl/history'],
    ['get-exchange-pl-history', '/exchange/pl/history'],
    ['get-portfolio-pl-history', '/portfolio/pl/history'],
];

test('registers all historical P&L tools as GET requests', () => {
    const configs = loadToolConfigs();

    for (const [name, endpoint] of expectedTools) {
        const config = configs.find((candidate) => candidate.name === name);
        assert.ok(config, `${name} should be registered`);
        assert.equal(config.endpoint, endpoint);
        assert.equal(config.method, 'GET');
    }
});

test('historical P&L tools accept preset and custom calendar ranges', () => {
    const configs = loadToolConfigs();

    for (const [name] of expectedTools) {
        const config = configs.find((candidate) => candidate.name === name);
        const base = name === 'get-wallet-pl-history'
            ? { address: '0xabc', connectionId: 'ethereum' }
            : name === 'get-exchange-pl-history'
                ? { portfolioId: 'portfolio-1' }
                : {};

        const preset = require('zod').z.object(config.parameters).safeParse({
            ...base,
            range: '1m',
            interval: 'daily',
            currency: 'USD',
        });
        assert.equal(preset.success, true, `${name} should accept range=1m`);

        const custom = require('zod').z.object(config.parameters).safeParse({
            ...base,
            from: '2025-09-01',
            to: '2025-10-01',
            interval: 'daily',
        });
        assert.equal(custom.success, true, `${name} should accept a calendar month`);

        const missingInterval = require('zod').z.object(config.parameters).safeParse({
            ...base,
            range: '1m',
        });
        assert.equal(missingInterval.success, false, `${name} should require interval`);
    }
});

test('wallet history exposes network selectors and portfolio history targets portfolios by id', () => {
    const configs = loadToolConfigs();
    const wallet = configs.find((candidate) => candidate.name === 'get-wallet-pl-history');
    const portfolio = configs.find((candidate) => candidate.name === 'get-portfolio-pl-history');

    assert.ok(wallet.parameters.connectionId);
    assert.ok(wallet.parameters.blockchain);
    assert.ok(portfolio.parameters.portfolioId);
    assert.equal(portfolio.emptyGuidance.length > 0, true);
});

test('no portfolio tool exposes shareToken or passcode — the API key covers the whole account', () => {
    const configs = loadToolConfigs();
    for (const config of configs.filter((candidate) => candidate.endpoint.startsWith('/portfolio'))) {
        assert.equal(config.parameters.shareToken, undefined, `${config.name} still exposes shareToken`);
        assert.equal(config.parameters.passcode, undefined, `${config.name} still exposes passcode`);
    }
});

test('add-portfolio-transaction requires portfolioId so writes never land in an implicit portfolio', () => {
    const { z } = require('zod');
    const configs = loadToolConfigs();
    const add = configs.find((candidate) => candidate.name === 'add-portfolio-transaction');
    const schema = z.object(add.parameters);

    assert.equal(schema.safeParse({ coinId: 'bitcoin', count: 1 }).success, false);
    assert.equal(schema.safeParse({ coinId: 'bitcoin', count: 1, portfolioId: 'p1' }).success, true);
});

test('delete-portfolio sends portfolioId as a path parameter', () => {
    const configs = loadToolConfigs();
    const del = configs.find((candidate) => candidate.name === 'delete-portfolio');

    assert.equal(del.method, 'DELETE');
    assert.equal(del.endpoint, '/portfolio/{portfolioId}');
    assert.equal(del.paramsInQuery, true);
    assert.ok(del.parameters.portfolioId);
});
