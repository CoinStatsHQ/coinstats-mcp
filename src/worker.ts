import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { allToolConfigs } from './tools/toolConfigs.js';
import { invokeTool, ToolConfig } from './tools/toolFactory.js';

interface Env {
    OAUTH_ISSUER: string;
    MCP_RESOURCE_URL: string;
    COINSTATS_API_BASE_URL?: string;
}

const SERVER_NAME = 'coinstats-mcp';
const SERVER_VERSION = '2.0.0';
const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

/**
 * Resolve this MCP server's canonical URL. Prefer the env-configured
 * value (e.g. `https://mcp.coinstats.app`) so the `resource` claim is
 * stable across replicas; fall back to deriving it from the inbound
 * request so the very first deploy on `*.workers.dev` works without
 * an extra config round-trip.
 */
function resolveResourceUrl(env: Env, request: Request): string {
    if (env.MCP_RESOURCE_URL) return env.MCP_RESOURCE_URL.replace(/\/$/, '');
    const url = new URL(request.url);
    return `${url.protocol}//${url.host}`;
}

/**
 * RFC 9728 Protected Resource Metadata. MCP clients fetch this to
 * discover which authorization server can issue tokens for this MCP.
 *
 * `scopes_supported` is advertised explicitly so MCP clients know which
 * scope to request for THIS resource. Without it, clients fall back to
 * the AS metadata's `scopes_supported`, which now lists ['coinstats',
 * 'admin'] (admin scope was added for the internal admin-MCP). Claude.ai
 * then requests both, and cloud rejects the combination with
 * `invalid_scope: admin scope cannot be combined with other scopes`.
 * Pinning to ['coinstats'] here keeps the consumer MCP's authorization
 * flow correct regardless of what the AS supports globally.
 */
function protectedResourceMetadata(env: Env, request: Request) {
    return {
        resource: resolveResourceUrl(env, request),
        authorization_servers: [env.OAUTH_ISSUER],
        scopes_supported: ['coinstats'],
        bearer_methods_supported: ['header'],
    };
}

function unauthorized(env: Env, request: Request, description: string): Response {
    const resource = resolveResourceUrl(env, request);
    const wwwAuth =
        `Bearer error="invalid_token", ` +
        `error_description="${description}", ` +
        `resource_metadata="${resource}/.well-known/oauth-protected-resource"`;
    return new Response(
        JSON.stringify({ error: 'invalid_token', error_description: description }),
        {
            status: 401,
            headers: {
                'Content-Type': 'application/json',
                'WWW-Authenticate': wwwAuth,
                ...corsHeaders(),
            },
        }
    );
}

function corsHeaders(): HeadersInit {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
    };
}

function extractBearer(req: Request): string | undefined {
    const auth = req.headers.get('authorization');
    if (!auth) return undefined;
    if (!auth.toLowerCase().startsWith('bearer ')) return undefined;
    const token = auth.slice(7).trim();
    return token || undefined;
}

function jsonRpcError(id: any, code: number, message: string) {
    return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code, message },
    };
}

function toolDescriptor(cfg: ToolConfig<any>) {
    const schema = zodToJsonSchema(z.object(cfg.parameters), {
        target: 'jsonSchema7',
        $refStrategy: 'none',
    }) as any;
    return {
        name: cfg.name,
        description: cfg.description,
        // MCP requires `inputSchema`; some clients also accept the JSON Schema
        // shape directly. We strip the wrapping `$schema` key zod-to-json-schema
        // adds at the root.
        inputSchema: {
            type: 'object',
            properties: schema.properties || {},
            required: schema.required || [],
            additionalProperties: false,
        },
    };
}

/**
 * Stateless JSON-RPC dispatch. The MCP server keeps no state across
 * requests — each call carries its own bearer and either references the
 * static tool catalog (`tools/list`) or invokes a single tool
 * (`tools/call`). `initialize` always returns the same capabilities;
 * the session id we hand back is decorative for clients that expect one.
 *
 * Returns `null` for notifications (no response body).
 */
async function dispatch(
    msg: any,
    token: string,
    protocolVersion: string
): Promise<any | null> {
    const id = msg?.id;
    const method = msg?.method;

    if (typeof method !== 'string') {
        return jsonRpcError(id, -32600, 'Invalid Request: missing method');
    }

    if (method === 'initialize') {
        const clientVersion = msg.params?.protocolVersion;
        return {
            jsonrpc: '2.0',
            id,
            result: {
                protocolVersion: clientVersion || protocolVersion,
                capabilities: { tools: {} },
                serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            },
        };
    }

    // Notifications — no response.
    if (method.startsWith('notifications/')) return null;

    if (method === 'ping') {
        return { jsonrpc: '2.0', id, result: {} };
    }

    if (method === 'tools/list') {
        return {
            jsonrpc: '2.0',
            id,
            result: { tools: allToolConfigs.map(toolDescriptor) },
        };
    }

    if (method === 'tools/call') {
        const name = msg.params?.name;
        const args = msg.params?.arguments || {};
        const cfg = allToolConfigs.find((c) => c.name === name);
        if (!cfg) {
            return jsonRpcError(id, -32601, `Tool not found: ${name}`);
        }
        try {
            const result = await invokeTool(cfg, args, token);
            return { jsonrpc: '2.0', id, result };
        } catch (err: any) {
            return jsonRpcError(id, -32000, `Tool error: ${err?.message || String(err)}`);
        }
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

async function handleMcpPost(request: Request, env: Env): Promise<Response> {
    const token = extractBearer(request);
    if (!token) return unauthorized(env, request, 'Missing bearer token');

    let body: any;
    try {
        body = await request.json();
    } catch {
        return new Response(
            JSON.stringify(jsonRpcError(null, -32700, 'Parse error')),
            { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
        );
    }

    const protocolVersion =
        request.headers.get('mcp-protocol-version') || DEFAULT_PROTOCOL_VERSION;

    // Batch (array of messages) or single message — handle both per JSON-RPC.
    const messages = Array.isArray(body) ? body : [body];
    const responses = await Promise.all(
        messages.map((m) => dispatch(m, token, protocolVersion))
    );
    const filtered = responses.filter((r) => r !== null);

    // 202 Accepted for pure-notification batches, 200 + body otherwise.
    if (filtered.length === 0) {
        return new Response(null, { status: 202, headers: corsHeaders() });
    }

    const responseBody = Array.isArray(body) ? filtered : filtered[0];
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        // Stateless: synthesize a session id for clients that key off it.
        // Subsequent requests can send any value — we ignore it.
        'Mcp-Session-Id': request.headers.get('mcp-session-id') || crypto.randomUUID(),
        ...corsHeaders(),
    };
    return new Response(JSON.stringify(responseBody), { status: 200, headers });
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        // Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders() });
        }

        // Favicon — redirect to the canonical CoinStats favicon so Claude /
        // other connector UIs render the right brand mark.
        if (url.pathname === '/favicon.ico') {
            return Response.redirect('https://coinstats.app/favicon.ico', 302);
        }

        // Health probe
        if (url.pathname === '/healthz') {
            return new Response(JSON.stringify({ ok: true }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders() },
            });
        }

        // RFC 9728 Protected Resource Metadata
        if (url.pathname === '/.well-known/oauth-protected-resource') {
            return new Response(JSON.stringify(protectedResourceMetadata(env, request)), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders() },
            });
        }

        // RFC 8414 Authorization Server Metadata, mirrored from the upstream
        // AS so older MCP clients that don't follow the RFC 9728 indirection
        // can still discover endpoints. Some clients also probe for `/mcp/`-
        // prefixed and `/mcp`-suffixed variants based on different
        // assumptions about which URL is the issuer — handle all three.
        if (
            url.pathname === '/.well-known/oauth-authorization-server' ||
            url.pathname === '/mcp/.well-known/oauth-authorization-server' ||
            url.pathname === '/.well-known/oauth-authorization-server/mcp'
        ) {
            const upstream = `${env.OAUTH_ISSUER.replace(/\/$/, '')}/.well-known/oauth-authorization-server`;
            try {
                const res = await fetch(upstream, {
                    headers: { Accept: 'application/json' },
                    cf: { cacheTtl: 3600, cacheEverything: true },
                });
                const body = await res.text();
                return new Response(body, {
                    status: res.status,
                    headers: {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=3600',
                        ...corsHeaders(),
                    },
                });
            } catch {
                return new Response(
                    JSON.stringify({ error: 'upstream_unavailable' }),
                    {
                        status: 502,
                        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
                    }
                );
            }
        }

        // MCP endpoints
        if (url.pathname === '/mcp') {
            if (request.method === 'POST') return handleMcpPost(request, env);

            // GET (SSE upgrade) and DELETE (session termination): we're
            // stateless, so just answer with 200 / no events / no body.
            const token = extractBearer(request);
            if (!token) return unauthorized(env, request, 'Missing bearer token');
            if (request.method === 'GET') {
                return new Response('', {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/event-stream',
                        'Cache-Control': 'no-store',
                        Connection: 'keep-alive',
                        ...corsHeaders(),
                    },
                });
            }
            if (request.method === 'DELETE') {
                return new Response(null, { status: 204, headers: corsHeaders() });
            }
            return new Response('Method not allowed', {
                status: 405,
                headers: corsHeaders(),
            });
        }

        return new Response('Not found', { status: 404, headers: corsHeaders() });
    },
};
