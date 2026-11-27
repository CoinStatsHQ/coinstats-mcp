import { z } from 'zod';
import { ToolConfig } from './toolFactory.js';
import { allToolConfigs, PORTFOLIO_EMPTY_GUIDANCE_WALLET_ONLY } from './toolConfigs.js';

/**
 * A tool profile is the tool set one MCP endpoint serves.
 *
 * - `default` (`/mcp`): every tool, arguments forwarded as sent.
 * - `chatgpt` (`/chatgpt/mcp`): the set submitted to the ChatGPT plugin
 *   directory. It leaves out tools that directory doesn't accept
 *   (third-party news aggregation, and tools that take exchange API
 *   credentials), narrows a few inputs, and validates every call's
 *   arguments against the advertised schema, dropping anything else.
 */
export interface ToolProfile {
    name: 'default' | 'chatgpt';
    tools: ToolConfig<any>[];
    /** Validate `tools/call` arguments with the tool's schema and pass on only the parsed result. */
    strictArguments: boolean;
}

/** Tools the ChatGPT profile leaves out entirely (hidden from tools/list and rejected on tools/call). */
export const CHATGPT_EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
    // Aggregated third-party news.
    'get-news',
    'get-news-by-type',
    'get-news-by-id',
    'get-news-sources',
    // Takes exchange API keys and secrets as tool input.
    'connect-portfolio-exchange',
    // Lists connectable exchanges and the credential fields each needs; only useful for the tool above.
    'get-exchanges',
]);

/** get-coins inputs kept for ChatGPT: search, paging, currency and the main filters. */
const CHATGPT_GET_COINS_PARAMETERS = ['name', 'symbol', 'blockchains', 'categories', 'sortBy', 'sortDir', 'page', 'limit', 'currency'];

function pick<T extends Record<string, unknown>>(obj: T, keys: string[]): Partial<T> {
    const out: Partial<T> = {};
    for (const key of keys) {
        if (key in obj) (out as any)[key] = obj[key];
    }
    return out;
}

/** Per-tool changes for the ChatGPT profile. */
const CHATGPT_OVERRIDES: Record<string, (cfg: ToolConfig<any>) => ToolConfig<any>> = {
    'get-coins': (cfg) => ({ ...cfg, parameters: pick(cfg.parameters, CHATGPT_GET_COINS_PARAMETERS) as any }),
    'search-prediction-markets': (cfg) => ({
        ...cfg,
        description:
            'Full-text search across prediction-market events and markets on Polymarket and Kalshi. Use it to find markets on a topic (e.g. "bitcoin", "fed rate"); each market carries a `slug` to pass to `get-prediction-market`. Prices are probabilities from 0 to 1; money is USD. Costs 3 API credits.',
        parameters: {
            ...cfg.parameters,
            // Always set, so results never include individual traders.
            type: z
                .enum(['markets', 'events'])
                .default('markets')
                .describe('Kind of result to return: `markets` (default) or `events`.'),
        },
    }),
    'get-ticker-exchanges': (cfg) => ({
        ...cfg,
        description:
            'List the exchanges CoinStats has market price (ticker) data for. Use these names with get-ticker-markets and get-coin-exchange-price.',
    }),
};

function chatgptTool(cfg: ToolConfig<any>): ToolConfig<any> {
    const override = CHATGPT_OVERRIDES[cfg.name];
    const out = override ? override(cfg) : { ...cfg };
    if (out.emptyGuidance) out.emptyGuidance = PORTFOLIO_EMPTY_GUIDANCE_WALLET_ONLY;
    return out;
}

export const DEFAULT_PROFILE: ToolProfile = {
    name: 'default',
    tools: allToolConfigs,
    strictArguments: false,
};

export const CHATGPT_PROFILE: ToolProfile = {
    name: 'chatgpt',
    tools: allToolConfigs.filter((cfg) => !CHATGPT_EXCLUDED_TOOLS.has(cfg.name)).map(chatgptTool),
    strictArguments: true,
};
