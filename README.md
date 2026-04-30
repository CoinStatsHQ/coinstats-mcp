# CoinStats MCP Server

Hosted [Model Context Protocol](https://modelcontextprotocol.io/) server for the CoinStats API. Lets AI agents (Claude, Cursor, Codex, ChatGPT — anything that speaks MCP) read and act on the same crypto data the CoinStats apps use, over a single OAuth-protected HTTPS URL.

There's no API key to copy and no env var to manage: each user authorises the agent against their own CoinStats account in the browser, and the agent gets a per-user token from then on.

<a href="https://glama.ai/mcp/servers/@CoinStatsHQ/coinstats-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@CoinStatsHQ/coinstats-mcp/badge" alt="CoinStats Server MCP server" />
</a>

## Server URL

```
https://mcp.coinstats.app/mcp
```

## Installation

### Claude.ai / Claude Desktop

Settings → **Connectors** → **Add custom connector**. Paste the server URL and click **Add**:

```
https://mcp.coinstats.app/mcp
```

A browser window opens at `coinstats.app/openapi/consent`. Sign in (or recognise your existing session), review the requested access, click **Approve**.

### Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=coinstats&config=eyJ1cmwiOiJodHRwczovL21jcC5jb2luc3RhdHMuYXBwL21jcCJ9)

Or add to `~/.cursor/mcp.json` manually:

```json
{
  "mcpServers": {
    "coinstats": {
      "url": "https://mcp.coinstats.app/mcp"
    }
  }
}
```

Restart Cursor; on first call it opens a browser window for the OAuth flow.

### Claude Code

```bash
claude mcp add coinstats --transport http https://mcp.coinstats.app/mcp
```

Claude Code opens a browser to authorise. Verify with:

```bash
claude mcp list
```

### Codex

`codex mcp add` only registers the URL; it does **not** open a browser. Run `codex mcp login` separately:

```bash
codex mcp add coinstats --url https://mcp.coinstats.app/mcp
codex mcp login coinstats
```

After the login step `codex mcp list` should show `Auth: OAuth` for `coinstats`.

### Other MCP clients

Any client that speaks the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) transport with OAuth 2.1 authorization will work. Point it at `https://mcp.coinstats.app/mcp` — Dynamic Client Registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) is supported, so no pre-shared `client_id` is needed.

## What you can do

After authorising, your agent can:

- Look up real-time prices, charts and market data for 100,000+ coins
- Read your CoinStats portfolio coins, P/L and performance over time
- Query wallet balances and transactions across 120+ blockchains
- Compare ticker pricing across 200+ exchanges
- Pull crypto news (latest, trending, filtered by source or topic)

Full tool catalog: [https://coinstats.app/api-docs/mcp/tools](https://coinstats.app/api-docs/mcp/tools).

## Authentication

Discovery + OAuth flow follows the standard MCP / RFC pattern:

| Endpoint | Spec | Purpose |
|---|---|---|
| `GET /.well-known/oauth-protected-resource` | [RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728) | Points at the authorization server (`https://api.coin-stats.com`) |
| `GET /.well-known/oauth-authorization-server` | [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) | AS metadata (also mirrored on the MCP host so older clients can find it without the indirection) |
| `POST /v1/oauth/register` (on AS) | [RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591) | Dynamic Client Registration |
| `GET /v1/oauth/authorize` → consent UI | OAuth 2.1 §4.1 | User approves access |
| `POST /v1/oauth/token` (on AS) | OAuth 2.1 §4.1 | PKCE code exchange |
| `POST /v1/oauth/revoke` (on AS) | [RFC 7009](https://datatracker.ietf.org/doc/html/rfc7009) | Per-client disconnect |

Token transport: `Authorization: Bearer <token>`. Single `coinstats` scope today; granular scopes are on the roadmap.

## Self-host / stdio fallback (developer mode)

If you want to run the MCP server yourself (no per-user OAuth, just a developer API key), the legacy stdio entry point is published on npm:

```bash
npx @coinstats/coinstats-mcp
```

with `COINSTATS_API_KEY` set in the env. Wire into a client like this:

```json
{
  "mcpServers": {
    "coinstats": {
      "command": "npx",
      "args": ["-y", "@coinstats/coinstats-mcp"],
      "env": { "COINSTATS_API_KEY": "<YOUR_API_KEY>" }
    }
  }
}
```

Or via Docker:

```json
{
  "mcpServers": {
    "coinstats": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "COINSTATS_API_KEY", "coinstats/coinstats-mcp"],
      "env": { "COINSTATS_API_KEY": "<YOUR_API_KEY>" }
    }
  }
}
```

This path is the right choice for headless / unattended integrations where there's no human to click "Approve". Get a key from the [CoinStats API Dashboard](https://openapi.coinstats.app).

## Architecture

The hosted server is a stateless Cloudflare Worker (~225 KiB / ~41 KiB gzipped) that:

1. Exposes the RFC 9728 + RFC 8414 discovery endpoints.
2. Gates `POST /mcp` on a `Authorization: Bearer …` token.
3. Dispatches MCP JSON-RPC (`initialize` / `tools/list` / `tools/call` / `ping`) without session state.
4. Forwards each tool call to `https://openapiv1.coinstats.app` carrying the same bearer.

Source: [`src/worker.ts`](./src/worker.ts). Config: [`wrangler.jsonc`](./wrangler.jsonc).

## Local development

The repo ships two entry points:

- **`src/worker.ts`** — Cloudflare Worker. Run with `wrangler dev` (port 8787 by default).
- **`src/index.ts`** — stdio server. Run with `node dist/index.js` after building, or via the published npm package.

```bash
# Build the stdio CLI
npm run build

# Run the Worker locally (requires `wrangler login` first)
npm run dev

# Deploy the Worker
npm run deploy

# Tail production logs
npm run tail
```

For local Worker development you can override env vars:

```bash
wrangler dev --var OAUTH_ISSUER:http://localhost:1337 \
             --var COINSTATS_API_BASE_URL:http://localhost:9999
```

## Related

- [CoinStats API docs](https://coinstats.app/api-docs) — full REST surface, MCP setup guide, tool catalog
- [API dashboard](https://openapi.coinstats.app) — for stdio-mode users to manage their developer API key

## License

MIT — see [LICENSE](./LICENSE).
