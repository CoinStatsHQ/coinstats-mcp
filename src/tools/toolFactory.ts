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

    if (bodyMethods.includes(method.toUpperCase())) {
        return universalApiHandler(basePath, config.endpoint, method, {}, params, token);
    }
    return universalApiHandler(basePath, config.endpoint, method, params, undefined, token);
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
