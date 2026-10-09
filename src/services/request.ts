import { COINSTATS_API_KEY } from '../config/constants.js';

/**
 * Non-2xx response from the CoinStats public API.
 *
 * `isInvalidToken` is true only for public-api-v2's `InvalidApiKeyException`
 * (401 + "Your API Key is invalid…"), i.e. the caller's key no longer exists
 * — revoked, or deleted by a password reset / log-out-everywhere. That is the
 * one case where the OAuth client should re-authorise. Other 401s can be
 * passed through from downstream services (portfolio / exchange / wallet)
 * and 402/403/406/429 are account-state errors: re-auth returns the same key
 * and fails again, so those must stay ordinary tool errors.
 */
export class CoinStatsApiError extends Error {
    name = 'CoinStatsApiError';
    readonly isInvalidToken: boolean;

    constructor(readonly status: number, readonly body: string) {
        super(`CoinStats API error ${status}: ${body}`);
        this.isInvalidToken = status === 401 && /API Key is invalid/i.test(body);
    }
}

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

    const options: RequestInit = { method, headers };

    if (method !== 'GET' && body) {
        options.body = JSON.stringify(body);
    }

    const queryParams = new URLSearchParams(params);
    const queryString = queryParams.toString();
    const urlWithParams = queryString ? `${url}?${queryString}` : url;

    const response = await fetch(urlWithParams, options);
    if (!response.ok) {
        const errorBody = await response.text();
        throw new CoinStatsApiError(response.status, errorBody || response.statusText);
    }
    return (await response.json()) as T;
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
    isError?: boolean;
}> {
    try {
        let processedEndpoint = endpoint;
        let processedParams = { ...params };

        const pathParamMatches = endpoint.match(/\{([^}]+)\}/g);

        if (pathParamMatches) {
            for (const match of pathParamMatches) {
                const paramName = match.slice(1, -1);

                if (processedParams[paramName] !== undefined) {
                    // Encode so values can't inject `?`, `&`, `/`, `#`; replacer fn avoids `$&`-style expansion.
                    const encoded = encodeURIComponent(String(processedParams[paramName]));
                    processedEndpoint = processedEndpoint.replace(match, () => encoded);
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
                isError: true,
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
        // A dead token is not a tool error — let it reach the transport so
        // the Worker can answer HTTP 401 and the client re-runs OAuth.
        if (error instanceof CoinStatsApiError && error.isInvalidToken) throw error;
        const message = error instanceof Error ? error.message : String(error);
        // `isError` belongs on the CallToolResult (MCP spec); the content-block
        // flag is kept for `isEmptyPayload` and older readers.
        return {
            content: [{ type: 'text', text: `Error: ${message}`, isError: true }],
            isError: true,
        };
    }
}
