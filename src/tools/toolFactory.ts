import { z, ZodType } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { universalApiHandler } from '../services/request.js';
import { COINSTATS_API_BASE } from '../config/constants.js';
import { saveToCache, getFromCache } from '../utils/cache.js';

export interface ToolConfig<T> {
    name: string;
    description: string;
    endpoint: string;
    method?: string;
    basePath?: string;
    parameters: Record<string, ZodType>;
    isLocal?: boolean;
    /**
     * Route params to the query string even for body methods (POST/PUT/
     * PATCH/DELETE). Some CoinStats write endpoints take their inputs as
     * query params with no JSON body — e.g. `PATCH /portfolio/sync` and the
     * single-wallet form of `PATCH /wallet/transactions`. Without this the
     * factory would put them in the body, the API would see no query params,
     * and the call would silently misbehave (or 400).
     */
    paramsInQuery?: boolean;
    /**
     * Optional human-facing message returned in place of an empty payload.
     * Used by the portfolio read tools: when the caller supplies no portfolio
     * selector (`shareToken`/`portfolioId`) and the API returns nothing, we
     * surface actionable instructions (share a portfolio, or connect one)
     * instead of a bare `[]` the model would misreport as "you have none".
     */
    emptyGuidance?: string;
}

/**
 * Detect an "empty" CoinStats payload so we can swap in `emptyGuidance`.
 * Covers the shapes the public API returns for an empty portfolio:
 * `[]`, `{}`, `{ result: [] }`, `{ result: null }`, `{ data: [] }`.
 * Errors are never treated as empty — their message is more useful.
 */
export function isEmptyPayload(result: ToolResult): boolean {
    const block = result.content?.[0];
    if (!block || block.isError) return false;
    let parsed: any;
    try {
        parsed = JSON.parse(block.text);
    } catch {
        return false;
    }
    if (parsed == null) return true;
    if (Array.isArray(parsed)) return parsed.length === 0;
    if (typeof parsed === 'object') {
        for (const key of ['result', 'data']) {
            if (key in parsed) {
                const inner = parsed[key];
                if (inner == null) return true;
                if (Array.isArray(inner)) return inner.length === 0;
            }
        }
        return Object.keys(parsed).length === 0;
    }
    return false;
}

export interface ToolResult {
    content: Array<{ type: 'text'; text: string; isError?: boolean }>;
}

export type TokenResolver = () => string | undefined;

/**
 * Run a single tool. Used by both the stdio entry (via the McpServer
 * wrapper in `registerTools`) and the Workers fetch handler (which
 * dispatches JSON-RPC `tools/call` directly without going through the
 * SDK's transport).
 */
export async function invokeTool(
    config: ToolConfig<any>,
    params: Record<string, any>,
    token?: string
): Promise<ToolResult> {
    if (config.isLocal) {
        if (config.name === 'save-share-token') {
            await saveToCache('shareToken', params.shareToken);
            return { content: [{ type: 'text', text: 'Share token saved successfully' }] };
        }
        if (config.name === 'get-share-token') {
            const shareToken = await getFromCache('shareToken');
            return {
                content: [
                    {
                        type: 'text',
                        text: shareToken ? shareToken : 'No share token found in cache',
                        isError: !shareToken,
                    },
                ],
            };
        }
        return { content: [{ type: 'text', text: 'Operation completed' }] };
    }

    const basePath = config.basePath || COINSTATS_API_BASE;
    const method = config.method || 'GET';
    const bodyMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const sendAsBody = bodyMethods.includes(method.toUpperCase()) && !config.paramsInQuery;

    const result = sendAsBody
        ? await universalApiHandler(basePath, config.endpoint, method, {}, params, token)
        : await universalApiHandler(basePath, config.endpoint, method, params, undefined, token);

    // When a portfolio read is called without a selector and comes back
    // empty, return actionable guidance instead of the bare empty payload
    // so the MCP client tells the user how to proceed (share a portfolio,
    // supply a passcode if protected, or connect a new wallet/exchange).
    if (
        config.emptyGuidance &&
        !params.shareToken &&
        !params.portfolioId &&
        isEmptyPayload(result)
    ) {
        return { content: [{ type: 'text', text: config.emptyGuidance }] };
    }

    return result;
}

/**
 * Register every tool from `toolConfigs` on the given MCP server. The
 * stdio entry point uses this; the Worker entry point dispatches
 * `tools/call` directly to `invokeTool` without an `McpServer`.
 *
 * `getToken` resolves the caller's bearer token at invocation time
 * (omitted on stdio — `request.ts` then falls back to `COINSTATS_API_KEY`).
 */
export function registerTools(
    server: McpServer,
    toolConfigs: ToolConfig<any>[],
    getToken?: TokenResolver
) {
    toolConfigs.forEach((config) => {
        // Cast to any to short-circuit the SDK's deep ZodRawShape inference,
        // which TS otherwise refuses to resolve for a heterogeneous tool list.
        (server.tool as any)(
            config.name,
            config.description,
            config.parameters,
            (params: Record<string, any>) => invokeTool(config, params, getToken?.())
        );
    });
}

export function createToolConfig<T>(
    name: string,
    description: string,
    endpoint: string,
    parameters: Record<string, ZodType>,
    method: string = 'GET',
    basePath?: string,
    isLocal: boolean = false
): ToolConfig<T> {
    return {
        name,
        description,
        endpoint,
        method,
        parameters,
        basePath,
        isLocal,
    };
}
