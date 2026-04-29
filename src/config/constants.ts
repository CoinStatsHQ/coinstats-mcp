// Upstream CoinStats public-API base URL. Override via env to point at a
// dev / staging deployment when testing the hosted MCP locally.
export const COINSTATS_API_BASE = process.env.COINSTATS_API_BASE_URL || 'https://openapiv1.coinstats.app';

// Fallback API key for the stdio transport (legacy npx use). The HTTP
// transport carries the user's OAuth-issued key in `Authorization: Bearer`
// and ignores this.
export const COINSTATS_API_KEY = process.env.COINSTATS_API_KEY || '';
