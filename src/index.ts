#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/toolFactory.js';
import { allToolConfigs } from './tools/toolConfigs.js';

// Create server instance
const server = new McpServer({
    name: 'coinstats-mcp',
    version: '2.0.0',
});

// Register all tools from configurations
registerTools(server, allToolConfigs);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('CoinStats MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Fatal error in main():', error);
    process.exit(1);
});
