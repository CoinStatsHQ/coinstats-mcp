[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/coinstatshq-coinstats-mcp-badge.png)](https://mseep.ai/app/coinstatshq-coinstats-mcp)

# CoinStats MCP Server

MCP Server for the CoinStats API. Provides access to cryptocurrency market data, portfolio tracking, and news.

<a href="https://glama.ai/mcp/servers/@CoinStatsHQ/coinstats-mcp">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@CoinStatsHQ/coinstats-mcp/badge" alt="CoinStats Server MCP server" />
</a>

## Setup

### API Key

You need a CoinStats API key. Obtain one from the [CoinStats API Dashboard](https://openapi.coinstats.app).
Read [API docs](https://coinstats.app/api-docs).


### Usage with MCP clients

Add the following to your client configuration:

#### Cursor

[![Install MCP Server](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=coinstats-mcp&config=eyJjb21tYW5kIjoibnB4IC15IEBjb2luc3RhdHMvY29pbnN0YXRzLW1jcCIsImVudiI6eyJDT0lOU1RBVFNfQVBJX0tFWSI6IiJ9fQ%3D%3D)

#### NPX

```json
{
  "mcpServers": {
    "coinstats-mcp": {
      "command": "npx",
      "args": [
        "-y",
        "@coinstats/coinstats-mcp"
      ],
      "env": {
        "COINSTATS_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Replace `<YOUR_API_KEY>` with your actual CoinStats API key.

#### Docker

```json
{
  "mcpServers": {
    "coinstats-mcp": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "COINSTATS_API_KEY",
        "coinstats/coinstats-mcp"
      ],
      "env": {
        "COINSTATS_API_KEY": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Replace `<YOUR_API_KEY>` with your actual CoinStats API key.

## Build

To build the project locally:

```bash
npm run build
```

This command installs dependencies, compiles TypeScript to JavaScript, and sets execute permissions.

## License

This MCP server is licensed under the MIT License. See the standard [MIT License text](https://opensource.org/licenses/MIT) for details.
