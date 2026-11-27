# CoinStats MCP Server

Hosted [Model Context Protocol](https://modelcontextprotocol.io/) server for the CoinStats API. Lets AI agents (Claude, ChatGPT, Cursor, VS Code, Codex — anything that speaks MCP) read and act on the same crypto data the CoinStats apps use, over a single OAuth-protected HTTPS URL.

**44 tools** cover prices and market data for 100,000+ coins, wallets on 120+ blockchains, DeFi positions, exchange accounts, CoinStats portfolios with P/L, crypto news, market indicators and prediction markets.

There's no API key to copy and no env var to manage: each user authorises the agent against their own CoinStats account in the browser, and the agent gets a per-user token from then on.

**Set it up in one click from [coinstats.app/mcp](https://coinstats.app/mcp)**, or follow the per-client steps below.

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

### ChatGPT

On the **Plugins** page, click **Add** and choose **Add custom MCP server**. Enter:

- **Name:** CoinStats
- **Server URL:** `https://mcp.coinstats.app/mcp`
- **Authentication:** OAuth

Check **I understand and want to continue**, click **Create as a plugin**, then install CoinStats from the **Personal** tab and approve access when asked. In a chat, type `@` and pick CoinStats, or just ask about your crypto. If you don't see **Add custom MCP server**, your workspace admin may have turned off custom MCP servers.

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

### VS Code (GitHub Copilot)

```bash
code --add-mcp '{"name":"coinstats","type":"http","url":"https://mcp.coinstats.app/mcp"}'
```

Use it from Copilot Chat in agent mode. VS Code asks you to sign in to CoinStats on first use.

### Other MCP clients

Windsurf, Cline, Gemini CLI, n8n and any other client that speaks the [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http) transport with OAuth 2.1 authorization will work. Point it at `https://mcp.coinstats.app/mcp` — Dynamic Client Registration ([RFC 7591](https://datatracker.ietf.org/doc/html/rfc7591)) is supported, so no pre-shared `client_id` is needed.

## Tools

The server exposes 44 tools. After authorising, your agent can:

| Area | Tools | What it can do |
|---|---|---|
| Market data | 10 | Real-time prices, market cap, volume and charts for 100,000+ coins; historical average and per-exchange prices; tickers across 200+ exchanges; global market stats; supported currencies |
| Market insights | 1 | CoinStats Fear & Greed Index (current and past year), Bitcoin dominance, Rainbow Chart |
| Wallets & DeFi | 8 | Balances and transactions for any address on 120+ blockchains, cash-flow-adjusted P/L history, DeFi positions (staking, liquidity pools, yield farming, rewards) |
| Exchanges | 6 | Supported exchanges, transactions and P/L history for connected accounts, open perpetual and futures positions and perpetual trade history (including Hyperliquid) |
| Portfolios | 11 | Your CoinStats portfolios: holdings, value chart, P/L history, transactions, sync status; connect a wallet or exchange, add a manual transaction, delete a portfolio |
| News | 4 | Latest, trending and handpicked crypto news with bullish/bearish reaction counts, by date range; single articles; news sources |
| Prediction markets | 4 | Search and browse Polymarket and Kalshi events and markets with current prices and volume |

Six tools change data on the user's account (syncing, connecting a wallet or exchange, adding a transaction, deleting a portfolio). Every tool carries MCP annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`), so clients can ask for confirmation before running them.

Full tool reference with parameters: [coinstats.app/api-docs/mcp/tools](https://coinstats.app/api-docs/mcp/tools).

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

The npm and Docker releases can lag behind `main`. To run the current tool set over stdio, build from source:

```bash
git clone https://github.com/CoinStatsHQ/coinstats-mcp.git
cd coinstats-mcp
npm run build
COINSTATS_API_KEY=<YOUR_API_KEY> node dist/index.js
```

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

# Deploy the Worker manually — needs CLOUDFLARE_ACCOUNT_ID exported in the
# env (the account ID isn't committed to wrangler.jsonc). Normally you don't
# need this: merging to main deploys automatically (see "Deployment" below).
export CLOUDFLARE_ACCOUNT_ID=<your-cf-account-id>
npm run deploy

# Tail production logs
npm run tail
```

For local Worker development you can override env vars:

```bash
wrangler dev --var OAUTH_ISSUER:http://localhost:1337 \
             --var COINSTATS_API_BASE_URL:http://localhost:9999
```

## Deployment

GitHub Actions (`.github/workflows/ci.yml`) builds, tests and dry-run bundles the Worker on every pull request. Each push to `main` runs the same checks, then deploys to `mcp.coinstats.app` and probes `/healthz`. The deploy job uses the `production` environment, which only protected branches can use, and reads two secrets from it: `CLOUDFLARE_API_TOKEN` (Workers deploy permission) and `CLOUDFLARE_ACCOUNT_ID`. Pull requests from forks run the checks without access to either secret. To redeploy without a new commit, run the workflow manually on `main`; the deploy job only ships the current tip of `main`, so re-running an old run fails instead of rolling back.

A failed post-deploy health check does not roll back automatically. To restore the previous version, run `npx wrangler rollback` (or pick a version under Workers & Pages → coinstats-mcp → Deployments in the Cloudflare dashboard), then fix forward on `main`.

### OpenAI plugin domain verification

The OpenAI plugin submission portal verifies domain ownership by fetching `https://mcp.coinstats.app/.well-known/openai-apps-challenge` and expecting the token it issued as plain text. The Worker serves the `OPENAI_APPS_CHALLENGE` env var at that path, and returns 404 when the variable is unset. Set it per deployment, outside the committed config:

```bash
wrangler secret put OPENAI_APPS_CHALLENGE
```

## Related

- [CoinStats MCP](https://coinstats.app/mcp) — one-click setup for Claude, ChatGPT, Cursor, VS Code and other clients
- [Tool reference](https://coinstats.app/api-docs/mcp/tools) — every tool with its parameters
- [CoinStats API docs](https://coinstats.app/api-docs) — full REST surface, MCP setup guide, tool catalog
- [API dashboard](https://openapi.coinstats.app) — for stdio-mode users to manage their developer API key

## License

MIT — see [LICENSE](./LICENSE).
