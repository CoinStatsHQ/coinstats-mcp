import { COINSTATS_API_KEY } from '../config/constants.js';

/**
 * Make a CoinStats API request, authenticating via the supplied token.
 *
 * The Worker entry point passes the per-request OAuth bearer it pulled
 * from `Authorization: Bearer …`. The stdio entry point passes nothing
 * and we fall back to the `COINSTATS_API_KEY` env (the developer's
 * dashboard key).
 *
 * Either way the wire shape is `X-API-KEY: <token>` because public-api-v2
 * already validates that header against `PublicApiKey` rows — both
 * dashboard keys and OAuth-issued tokens live in the same collection
 * and authenticate the same way.
 */
export async function makeRequestCsApi<T>(
    url: string,
    method: string = 'GET',
    params: Record<string, any> = {},
    body?: any,
    token?: string
): Promise<T | null> {
    const apiKey = token || COINSTATS_API_KEY;
    if (!apiKey) {
        throw new Error(
            'No CoinStats API key — send Authorization: Bearer <token> over the HTTP transport, or set COINSTATS_API_KEY for stdio.'
        );
    }
    const headers = {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
    };

    try {
        const options: RequestInit = { method, headers };

        if (method !== 'GET' && body) {
            options.body = JSON.stringify(body);
        }

        const queryParams = new URLSearchParams(params);
        const queryString = queryParams.toString();
        const urlWithParams = queryString ? `${url}?${queryString}` : url;

        const response = await fetch(urlWithParams, options);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return (await response.json()) as T;
    } catch (error) {
        return null;
    }
}

/**
 * Universal MCP-tool handler — translates a tool's structured params into
 * a CoinStats public-API request, then wraps the JSON response in the
 * MCP content format.
 *
 * Path parameters in `endpoint` like `/coins/{coinId}` are substituted
 * from `params` (and removed from the query string).
 */
export async function universalApiHandler<T>(
    basePath: string,
    endpoint: string,
    method: string = 'GET',
    params: Record<string, any> = {},
    body?: any,
    token?: string
): Promise<{
    content: Array<{ type: 'text'; text: string; isError?: boolean }>;
}> {
    try {
        let processedEndpoint = endpoint;
        let processedParams = { ...params };

        const pathParamMatches = endpoint.match(/\{([^}]+)\}/g);

        if (pathParamMatches) {
            for (const match of pathParamMatches) {
                const paramName = match.slice(1, -1);

                if (processedParams[paramName] !== undefined) {
                    processedEndpoint = processedEndpoint.replace(match, processedParams[paramName]);
                    delete processedParams[paramName];
                } else {
                    throw new Error(`Required path parameter '${paramName}' is missing`);
                }
            }
        }

        // MCP clients may not handle `~` in parameter names cleanly, so we
        // accept `-` from clients and rewrite to `~` (the `/coins` filter
        // separator the public API expects).
        if (endpoint === '/coins') {
            processedParams = Object.entries(processedParams).reduce((acc, [key, value]) => {
                acc[key.replace(/-/g, '~')] = value;
                return acc;
            }, {} as Record<string, any>);
        }

        const url = `${basePath}${processedEndpoint}`;
        const data = await makeRequestCsApi<T>(url, method, processedParams, body, token);

        if (!data) {
            return {
                content: [{ type: 'text', text: 'Something went wrong', isError: true }],
            };
        }

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(data),
                },
            ],
        };
    } catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error}`, isError: true }],
        };
    }
}
