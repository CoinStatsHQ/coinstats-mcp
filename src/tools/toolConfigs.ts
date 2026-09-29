import { z } from 'zod';
import { ToolConfig } from './toolFactory.js';

/**
 * Shown (in place of an empty result) when a portfolio read is called with no
 * portfolio selector and the account has nothing to aggregate. Gives the user
 * a concrete next step instead of a misleading "you have no holdings".
 */
const PORTFOLIO_EMPTY_GUIDANCE = [
    'No portfolio data found. You are authenticated, but no portfolio was specified and this account has no holdings yet.',
    '',
    'To continue, choose one:',
    '1) Call `get-portfolio-list` to see every portfolio on the account and pass one as `portfolioId`.',
    '2) Set up a new portfolio here — call `connect-portfolio-wallet` (with a wallet address) or `connect-portfolio-exchange` (with exchange API credentials). Once connected, retry and your holdings will appear automatically.',
].join('\n');

/**
 * Accepted `connectionId` / `blockchain` values, per the public-API docs.
 * `*_FORCEALL` applies where the endpoint supports the latency-bounded "all"
 * plus the exhaustive "forceall" (wallet balance & wallet status). `*_ALL`
 * applies where only "all" is documented (wallet transactions sync & defi).
 */
const WALLET_NETWORK_VALUES_FORCEALL =
    'Accepts a single value (e.g. "ethereum"), a comma-separated list ("ethereum,polygon"), "all" (top-tier EVM chains are forced; slower non-top-tier chains may be skipped by a per-chain latency limit), or "forceall" (every supported chain, no latency limit — the response waits for the slowest chain).';
const WALLET_NETWORK_VALUES_ALL =
    'Accepts a single value (e.g. "ethereum"), a comma-separated list ("ethereum,polygon"), or "all" for every connection.';

const PROFIT_LOSS_RANGES = ['24h', '1w', '1m', '3m', '6m', '1y', 'all'] as const;
const PROFIT_LOSS_INTERVALS = ['hourly', 'daily', 'weekly', 'monthly', 'yearly'] as const;

const profitLossHistoryParameters = () => ({
    range: z
        .enum(PROFIT_LOSS_RANGES)
        .optional()
        .describe('Preset time range. Provide range OR both from and to, never both.'),
    from: z
        .string()
        .optional()
        .describe('Inclusive custom-range start as YYYY-MM-DD or an ISO timestamp with timezone. Must be paired with to and used without range.'),
    to: z
        .string()
        .optional()
        .describe('Exclusive custom-range end as YYYY-MM-DD or an ISO timestamp with timezone. Must be paired with from and used without range.'),
    interval: z
        .enum(PROFIT_LOSS_INTERVALS)
        .describe('Chart bucket interval. Hourly is valid only for 24h or a custom window within the latest 24 hours.'),
    currency: z.string().optional().describe('Currency for P&L values.').default('USD'),
});

// Collection of all tool configurations
export const allToolConfigs: ToolConfig<any>[] = [
    // Coin List Tool Configuration
    {
        name: 'get-coins',
        description:
            'Get comprehensive data about all cryptocurrencies: Price, market cap, and volume. Price changes (1h, 24h, 7d). Supply information. Trading metrics. Social links and metadata.',
        endpoint: '/coins',
        method: 'GET',
        parameters: {
            name: z.string().optional().describe('Search coins by name'),
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
            currency: z.string().optional().describe('Currency for price data').default('USD'),
            symbol: z.string().optional().describe('Get coins by symbol'),
            blockchains: z.string().optional().describe('Blockchain filters, separated by commas (e.g., ethereum,solana)'),
            includeRiskScore: z.string().optional().describe('Include risk score: true or false. Default - false'),
            categories: z.string().optional().describe('Category filters, separated by commas (e.g., memecoins,sports)'),
            sortBy: z.string().optional().describe('Field to sort by'),
            sortDir: z.enum(['asc', 'desc']).optional().describe('Sort direction'),

            // Market Cap filters
            'marketCap-greaterThan': z.number().optional().describe('Marketcap Greater Than'),
            'marketCap-equals': z.number().optional().describe('Marketcap Equals'),
            'marketCap-lessThan': z.number().optional().describe('Marketcap Less Than'),

            // Fully Diluted Valuation filters
            'fullyDilutedValuation-greaterThan': z.number().optional().describe('Fully Diluted Valuation Greater Than'),
            'fullyDilutedValuation-equals': z.number().optional().describe('Fully Diluted Valuation Equals'),
            'fullyDilutedValuation-lessThan': z.number().optional().describe('Fully Diluted Valuation Less Than'),

            // Volume filters
            'volume-greaterThan': z.number().optional().describe('Volume Greater Than'),
            'volume-equals': z.number().optional().describe('Volume Equals'),
            'volume-lessThan': z.number().optional().describe('Volume Less Than'),

            // Price Change filters
            'priceChange1h-greaterThan': z.number().optional().describe('Price Change 1h Greater Than'),
            'priceChange1h-equals': z.number().optional().describe('Price Change 1h Equals'),
            'priceChange1h-lessThan': z.number().optional().describe('Price Change 1h Less Than'),

            'priceChange1d-greaterThan': z.number().optional().describe('Price Change 1d Greater Than'),
            'priceChange1d-equals': z.number().optional().describe('Price Change 1d Equals'),
            'priceChange1d-lessThan': z.number().optional().describe('Price Change 1d Less Than'),

            'priceChange7d-greaterThan': z.number().optional().describe('Price Change 7d Greater Than'),
            'priceChange7d-equals': z.number().optional().describe('Price Change 7d Equals'),
            'priceChange7d-lessThan': z.number().optional().describe('Price Change 7d Less Than'),

            // Supply filters
            'availableSupply-greaterThan': z.number().optional().describe('Available Supply Greater Than'),
            'availableSupply-equals': z.number().optional().describe('Available Supply Equals'),
            'availableSupply-lessThan': z.number().optional().describe('Available Supply Less Than'),

            'totalSupply-greaterThan': z.number().optional().describe('Total Supply Greater Than'),
            'totalSupply-equals': z.number().optional().describe('Total Supply Equals'),
            'totalSupply-lessThan': z.number().optional().describe('Total Supply Less Than'),

            // Rank filters
            'rank-greaterThan': z.number().optional().describe('Rank Greater Than'),
            'rank-equals': z.number().optional().describe('Rank Equals'),
            'rank-lessThan': z.number().optional().describe('Rank Less Than'),

            // Price filters
            'price-greaterThan': z.number().optional().describe('Price Greater Than'),
            'price-equals': z.number().optional().describe('Price Equals'),
            'price-lessThan': z.number().optional().describe('Price Less Than'),

            // Risk Score filters
            'riskScore-greaterThan': z.number().optional().describe('Risk Score Greater Than (Only if includeRiskScore=true)'),
            'riskScore-equals': z.number().optional().describe('Risk Score Equals (Only if includeRiskScore=true)'),
            'riskScore-lessThan': z.number().optional().describe('Risk Score Less Than (Only if includeRiskScore=true)'),
        },
    },

    // Coin by ID Tool Configuration
    {
        name: 'get-coin-by-id',
        description: 'Get detailed information about a specific cryptocurrency based on its unique identifier.',
        endpoint: '/coins/{coinId}',
        method: 'GET',
        parameters: {
            coinId: z.string().describe('The identifier of coin, which you received from /coins call response.'),
            currency: z.string().optional().describe('Currency for price data').default('USD'),
        },
    },

    // Coin Chart by ID Tool Configuration
    {
        name: 'get-coin-chart-by-id',
        description: 'Get chart data for a specific cryptocurrency based on its unique identifier, specifying different time ranges.',
        endpoint: '/coins/{coinId}/charts',
        method: 'GET',
        parameters: {
            coinId: z.string().describe('The identifier of coin, which you received from /coins call response.'),
            period: z.enum(['all', '24h', '1w', '1m', '3m', '6m', '1y']).describe('Time period for chart data'),
        },
    },

    // Coin Average Price Tool Configuration
    {
        name: 'get-coin-avg-price',
        description: 'Get the historical average price for a specific cryptocurrency based on its unique identifier and a specific date.',
        endpoint: '/coins/price/avg',
        method: 'GET',
        parameters: {
            coinId: z.string().describe('The identifier of coin'),
            timestamp: z.number().describe('Unix timestamp'),
        },
    },

    // Coin Exchange Price Tool Configuration
    {
        name: 'get-coin-exchange-price',
        description: 'Get the historical price data for a specific cryptocurrency on a particular exchange.',
        endpoint: '/coins/price/exchange',
        method: 'GET',
        parameters: {
            exchange: z.string().describe('Exchange name'),
            from: z.string().describe('From currency/coin symbol'),
            to: z.string().describe('To currency/coin symbol'),
            timestamp: z.number().describe('Unix timestamp'),
        },
    },

    // Ticker Exchanges Tool Configuration
    {
        name: 'get-ticker-exchanges',
        description: 'Get a list of supported exchanges.',
        endpoint: '/tickers/exchanges',
        method: 'GET',
        parameters: {},
    },

    // Ticker Markets Tool Configuration
    {
        name: 'get-ticker-markets',
        description: 'Get a list of tickers for a specific cryptocurrency across different exchanges.',
        endpoint: '/tickers/markets',
        method: 'GET',
        parameters: {
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
            exchange: z.string().optional().describe('Exchange name'),
            fromCoin: z.string().optional().describe('From currency/coin symbol'),
            toCoin: z.string().optional().describe('To currency/coin symbol'),
            coinId: z.string().optional().describe('Coin identifier'),
            onlyVerified: z.boolean().optional().describe('Filter only verified exchanges'),
        },
    },

    // Wallet Blockchains Tool Configuration
    {
        name: 'get-blockchains',
        description: 'Get a list of supported blockchains by CoinStats.',
        endpoint: '/wallet/blockchains',
        method: 'GET',
        parameters: {},
    },

    // Wallet Balance Tool Configuration
    {
        name: 'get-wallet-balance',
        description: 'Get the balance data for a provided wallet address. Query one network, several, or every supported network at once.',
        endpoint: '/wallet/balance',
        method: 'GET',
        parameters: {
            address: z.string().describe('Wallet address'),
            connectionId: z
                .string()
                .optional()
                .describe(`Connection id from get-blockchains. Provide connectionId OR blockchain (connectionId is used if both are given). ${WALLET_NETWORK_VALUES_FORCEALL}`),
            blockchain: z
                .string()
                .optional()
                .describe(`Blockchain network id from get-blockchains. Provide connectionId OR blockchain. ${WALLET_NETWORK_VALUES_FORCEALL}`),
        },
    },

    // Wallet Balances Tool Configuration
    {
        name: 'get-wallet-balances',
        description: 'Get the balance data for a provided wallet address on all CoinStats supported networks.',
        endpoint: '/wallet/balances',
        method: 'GET',
        parameters: {
            address: z.string().describe('The wallet address for which the balance is being queried'),
            networks: z
                .string()
                .optional()
                .describe('Blockchain networks to query, comma-separated (e.g., "ethereum,polygon,binance")')
                .default('all'),
        },
    },

    // Wallet Sync Status Tool Configuration
    {
        name: 'get-wallet-sync-status',
        description: 'Get the syncing status of the wallet with the blockchain network.',
        endpoint: '/wallet/status',
        method: 'GET',
        parameters: {
            address: z.string().describe('Wallet address'),
            connectionId: z
                .string()
                .optional()
                .describe(`Connection id from get-blockchains. Provide connectionId OR blockchain (connectionId is used if both are given). ${WALLET_NETWORK_VALUES_FORCEALL}`),
            blockchain: z
                .string()
                .optional()
                .describe(`Blockchain network id from get-blockchains. Provide connectionId OR blockchain. ${WALLET_NETWORK_VALUES_FORCEALL}`),
        },
    },

    // Wallet Transactions Tool Configuration
    {
        name: 'get-wallet-transactions',
        description: 'Get transaction data for a specific wallet. Ensure transactions are synced by calling PATCH /transactions first.',
        endpoint: '/wallet/transactions',
        method: 'GET',
        parameters: {
            address: z.string().describe('Wallet address'),
            connectionId: z.string().describe('The identifier of connection, which you received from /wallet/blockchains call response.'),
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
            from: z.string().optional().describe('Start date in ISO 8601 format'),
            to: z.string().optional().describe('End date in ISO 8601 format'),
            currency: z.string().optional().describe('Currency for price data').default('USD'),
            types: z.string().optional().describe('Transaction types, comma separated (deposit,withdraw,approve,executed,balance,fee)'),
            txId: z.string().optional().describe('To search with transaction hash'),
        },
    },

    // Wallet Profit/Loss History Tool Configuration
    {
        name: 'get-wallet-pl-history',
        description:
            'Get cash-flow-adjusted historical P&L for a wallet across one or more synchronized networks. Use transactions-sync first and poll get-wallet-sync-status when fresh history is required. COST WARNING: 25 credits per requested network; connectionId/blockchain="all" costs 250 credits.',
        endpoint: '/wallet/pl/history',
        method: 'GET',
        parameters: {
            address: z.string().describe('Wallet address whose synchronized history should be used.'),
            connectionId: z
                .string()
                .optional()
                .describe(`Connection id, comma-separated connection ids, or "all". Provide connectionId OR blockchain; connectionId takes precedence. ${WALLET_NETWORK_VALUES_ALL}`),
            blockchain: z
                .string()
                .optional()
                .describe(`Blockchain id, comma-separated blockchain ids, or "all". Used only when connectionId is omitted. ${WALLET_NETWORK_VALUES_ALL}`),
            ...profitLossHistoryParameters(),
        },
    },

    // Wallet Transactions Sync Tool Configuration
    {
        name: 'transactions-sync',
        description: 'Initiate the syncing process to update transaction data for a specific wallet.',
        endpoint: '/wallet/transactions',
        method: 'PATCH',
        // The single-wallet form expects address + connectionId as QUERY
        // params (no JSON body). Routing them to the body 400s with
        // "For single wallet sync, both address and connectionId ... must be provided".
        paramsInQuery: true,
        parameters: {
            address: z.string().describe('Wallet address'),
            connectionId: z
                .string()
                .optional()
                .describe(`Connection id from get-blockchains for single-wallet sync. Provide connectionId OR blockchain (connectionId is used if both are given). ${WALLET_NETWORK_VALUES_ALL}`),
            blockchain: z
                .string()
                .optional()
                .describe(`Blockchain network id from get-blockchains. Provide connectionId OR blockchain. ${WALLET_NETWORK_VALUES_ALL}`),
        },
    },

    // Wallet DeFi Tool Configuration
    {
        name: 'get-wallet-defi',
        description:
            'Get DeFi positions (staking, liquidity pools, yield farming, earned rewards) for a wallet address. COST WARNING: this is an expensive, paid-plan endpoint — 400 credits per request, multiplied by the number of connectionId/blockchain values, and 4000 credits if either is "all". Prefer a single specific network; avoid "all" unless explicitly requested.',
        endpoint: '/wallet/defi',
        method: 'GET',
        parameters: {
            address: z.string().describe('Wallet address to query.'),
            connectionId: z
                .string()
                .optional()
                .describe(`Connection id from get-blockchains. Provide connectionId OR blockchain (connectionId is used if both are given). ${WALLET_NETWORK_VALUES_ALL}`),
            blockchain: z
                .string()
                .optional()
                .describe(`Blockchain network id from get-blockchains. Provide connectionId OR blockchain. ${WALLET_NETWORK_VALUES_ALL}`),
        },
    },

    // Exchange Support Tool Configuration
    {
        name: 'get-exchanges',
        description: 'Get a list of supported exchange portfolio connections by CoinStats.',
        endpoint: '/exchange/support',
        method: 'GET',
        parameters: {},
    },

    // Exchange Balance Tool Configuration
    {
        name: 'get-exchange-balance',
        description: 'Get the balance data for a provided Exchange.',
        endpoint: '/exchange/balance',
        method: 'POST',
        parameters: {
            connectionFields: z
                .object({
                    apiKey: z.string().optional().describe('Exchange API key'),
                    apiSecret: z.string().optional().describe('Exchange API secret'),
                    passphrase: z
                        .string()
                        .optional()
                        .describe('API passphrase — required by some exchanges (e.g. Bitget, OKX, KuCoin)'),
                })
                .passthrough()
                .describe(
                    'Exchange API credentials. Required fields vary per exchange — call get-exchanges (/exchange/support) for the exact fields a given connectionId needs. Common fields: apiKey, apiSecret, passphrase.'
                ),
            connectionId: z.string().describe('The exchange connection id'),
        },
    },

    // Exchange Sync Status Tool Configuration
    {
        name: 'get-exchange-sync-status',
        description: 'Get the syncing status of the exchange portfolio.',
        endpoint: '/exchange/status',
        method: 'GET',
        parameters: {
            portfolioId: z.string().describe('The identifier of portfolio, which you received from /exchange/balance call response.'),
        },
    },

    // Exchange Transactions Tool Configuration
    {
        name: 'get-exchange-transactions',
        description: 'Get transaction data for a specific exchange.',
        endpoint: '/exchange/transactions',
        method: 'GET',
        parameters: {
            portfolioId: z.string().describe('The identifier of portfolio, which you received from /exchange/balance response.'),
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
            from: z.string().optional().describe('Start date in ISO 8601 format'),
            to: z.string().optional().describe('End date in ISO 8601 format'),
            currency: z.string().optional().describe('Currency for price data').default('USD'),
            types: z.string().optional().describe('Transaction types, comma separated (deposit,withdraw,approve,executed,balance,fee)'),
        },
    },

    // Exchange Profit/Loss History Tool Configuration
    {
        name: 'get-exchange-pl-history',
        description:
            'Get cash-flow-adjusted historical P&L for an owned exchange portfolio. Deposits and withdrawals are removed from investment performance. Costs 25 credits per request.',
        endpoint: '/exchange/pl/history',
        method: 'GET',
        parameters: {
            portfolioId: z
                .string()
                .describe('Owned exchange portfolio id from get-exchange-balance or get-portfolio-list.'),
            ...profitLossHistoryParameters(),
        },
    },

    // Fiats Tool Configuration
    {
        name: 'get-fiat-currencies',
        description: 'Get a list of fiat currencies supported by CoinStats.',
        endpoint: '/fiats',
        method: 'GET',
        parameters: {},
    },

    // News Sources Tool Configuration
    {
        name: 'get-news-sources',
        description: 'Get news sources.',
        endpoint: '/news/sources',
        method: 'GET',
        parameters: {},
    },

    // News Tool Configuration
    {
        name: 'get-news',
        description: 'Get news articles with pagination.',
        endpoint: '/news',
        method: 'GET',
        parameters: {
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
            from: z.string().optional().describe('Start date in ISO 8601 format'),
            to: z.string().optional().describe('End date in ISO 8601 format'),
        },
    },

    // News by Type Tool Configuration
    {
        name: 'get-news-by-type',
        description: 'Get news articles based on a type.',
        endpoint: '/news/type/{type}',
        method: 'GET',
        parameters: {
            type: z.enum(['handpicked', 'trending', 'latest', 'bullish', 'bearish']).describe('News type'),
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
        },
    },

    // News by ID Tool Configuration
    {
        name: 'get-news-by-id',
        description: 'Get news by id.',
        endpoint: '/news/{id}',
        method: 'GET',
        parameters: {
            id: z.string().describe('News article ID'),
        },
    },

    // Markets Tool Configuration
    {
        name: 'get-market-cap',
        description: 'Get global market data.',
        endpoint: '/markets',
        method: 'GET',
        parameters: {},
    },

    // Portfolio List Tool Configuration
    {
        name: 'get-portfolio-list',
        description:
            'List every portfolio on the user\'s CoinStats account — ones built in the app and ones created via connect-portfolio-wallet/exchange. Returns portfolioId, portfolioName and portfolioType (manual, exchange, wallet, ...). Call this first and pass portfolioId to the other portfolio tools; transactions can be added only to manual portfolios.',
        endpoint: '/portfolio/list',
        method: 'GET',
        parameters: {},
    },

    // Portfolio Sync Tool Configuration
    {
        name: 'sync-portfolio',
        description:
            'Trigger a re-sync for one of the user\'s wallet or exchange portfolios, then poll get-portfolio-sync-status until it reports "synced". COST WARNING: pass portfolioId to sync just that portfolio (30 credits). Manual portfolios cannot be synced. Omitting portfolioId syncs ALL of the user\'s non-manual portfolios at 10x credits — only do that on explicit request.',
        endpoint: '/portfolio/sync',
        method: 'PATCH',
        paramsInQuery: true,
        parameters: {
            portfolioId: z
                .string()
                .optional()
                .describe('Sync only this portfolio (from get-portfolio-list or a connect-portfolio-* call). Omit to sync all portfolios (10x credits).'),
        },
    },

    // Portfolio Sync Status Tool Configuration
    {
        name: 'get-portfolio-sync-status',
        description:
            'Get the sync status ("syncing" or "synced") of one of the user\'s portfolios. Use after sync-portfolio to know when data is ready.',
        endpoint: '/portfolio/status',
        method: 'GET',
        parameters: {
            portfolioId: z.string().describe('The portfolio id (from get-portfolio-list or a connect-portfolio-* call).'),
        },
    },

    // Portfolio Coins Tool Configuration
    {
        name: 'get-portfolio-coins',
        description:
            'Get a list of portfolio coins with P/L and other data displayed on CoinStats web. Pass portfolioId (from get-portfolio-list) to target one portfolio; omit it to aggregate all of the user\'s portfolios.',
        endpoint: '/portfolio/coins',
        method: 'GET',
        emptyGuidance: PORTFOLIO_EMPTY_GUIDANCE,
        parameters: {
            portfolioId: z
                .string()
                .optional()
                .describe('Portfolio id from get-portfolio-list. Omit to aggregate all of the user\'s portfolios.'),
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
            includeRiskScore: z.string().optional().describe('Include risk score: true or false. Default - false'),
        },
    },

    // Portfolio Chart Tool Configuration
    {
        name: 'get-portfolio-chart',
        description:
            'Get portfolio performance chart data. Pass portfolioId (from get-portfolio-list) to target one portfolio; omit it to aggregate all of the user\'s portfolios.',
        endpoint: '/portfolio/chart',
        method: 'GET',
        emptyGuidance: PORTFOLIO_EMPTY_GUIDANCE,
        parameters: {
            portfolioId: z
                .string()
                .optional()
                .describe('Portfolio id from get-portfolio-list. Omit to aggregate all of the user\'s portfolios.'),
            type: z.string().describe('One of 24h, 1w, 1m, 3m, 6m, 1y, all'),
        },
    },

    // Portfolio Profit/Loss History Tool Configuration
    {
        name: 'get-portfolio-pl-history',
        description:
            'Get cash-flow-adjusted historical P&L for one portfolio or all of the user\'s portfolios. Deposits and withdrawals are removed from investment performance. Costs 25 credits per request.',
        endpoint: '/portfolio/pl/history',
        method: 'GET',
        emptyGuidance: PORTFOLIO_EMPTY_GUIDANCE,
        parameters: {
            portfolioId: z
                .string()
                .optional()
                .describe('Portfolio id from get-portfolio-list. Omit to aggregate all of the user\'s portfolios.'),
            ...profitLossHistoryParameters(),
        },
    },

    // Portfolio Transactions Tool Configuration
    {
        name: 'get-portfolio-transactions',
        description:
            'Get a list of portfolio transactions. Pass portfolioId (from get-portfolio-list) to target one portfolio; omit it to aggregate all of the user\'s portfolios.',
        endpoint: '/portfolio/transactions',
        method: 'GET',
        emptyGuidance: PORTFOLIO_EMPTY_GUIDANCE,
        parameters: {
            portfolioId: z
                .string()
                .optional()
                .describe('Portfolio id from get-portfolio-list. Omit to aggregate all of the user\'s portfolios.'),
            page: z.number().optional().describe('Page number').default(1),
            limit: z.number().optional().describe('Number of results per page').default(20),
            currency: z.string().describe('Currency for price data'),
            coinId: z.string().optional().describe('Filter by coin ID'),
        },
    },

    // Connect Portfolio Wallet Tool Configuration
    {
        name: 'connect-portfolio-wallet',
        description:
            'Connect a wallet address to the account and create a tracked portfolio. Returns a portfolioId you can pass to the other portfolio tools. Creates a real portfolio on the user\'s account and starts a background transaction sync.',
        endpoint: '/portfolio/wallet',
        method: 'POST',
        parameters: {
            address: z.string().describe('Wallet address to connect.'),
            connectionId: z
                .string()
                .describe('Blockchain network identifier (e.g., "ethereum", "polygon"). Use get-blockchains for supported networks.'),
            name: z.string().optional().describe('Optional display name for the portfolio.'),
        },
    },

    // Connect Portfolio Exchange Tool Configuration
    {
        name: 'connect-portfolio-exchange',
        description:
            'Connect an exchange account to the account and create a tracked portfolio. Returns a portfolioId you can pass to the other portfolio tools. Creates a real portfolio on the user\'s account and starts a background transaction sync.',
        endpoint: '/portfolio/exchange',
        method: 'POST',
        parameters: {
            connectionId: z
                .string()
                .describe('The exchange connection id (e.g., "binance"). Use get-exchanges for the list of supported exchanges.'),
            connectionFields: z
                .object({
                    apiKey: z.string().optional().describe('Exchange API key'),
                    apiSecret: z.string().optional().describe('Exchange API secret'),
                    passphrase: z
                        .string()
                        .optional()
                        .describe('API passphrase — required by some exchanges (e.g. Bitget, OKX, KuCoin)'),
                })
                .passthrough()
                .describe(
                    'Exchange API credentials. Required fields vary per exchange — call get-exchanges (/exchange/support) for the exact fields a given connectionId needs. Common fields: apiKey, apiSecret, passphrase.'
                ),
            name: z.string().optional().describe('Optional display name for the portfolio.'),
        },
    },

    // Add Portfolio Transaction Tool Configuration
    {
        name: 'add-portfolio-transaction',
        description:
            'Add a buy/sell transaction to one of the user\'s manual portfolios. portfolioId is required — call get-portfolio-list and pick a portfolio with portfolioType "manual"; if more than one fits, ask the user which one. Wallet/exchange portfolios sync automatically and cannot take manual transactions.',
        endpoint: '/portfolio/transaction',
        method: 'POST',
        parameters: {
            coinId: z.string().describe('Coin ID from CoinStats (e.g. "bitcoin"). For fiats use the form "FiatCoinUSD".'),
            count: z.number().describe('Amount of coin. For sell transactions, this should be negative.'),
            price: z.number().optional().describe('Price of coin in USD at the time of transaction.'),
            date: z.number().optional().describe('Transaction date in milliseconds (Unix epoch ms). Defaults to now if omitted.'),
            portfolioId: z.string().describe('Target manual portfolio id from get-portfolio-list.'),
            currency: z.string().optional().describe('Currency for the price. Default is USD.'),
            notes: z.string().optional().describe('Transaction notes.'),
        },
    },

    // Delete Portfolio Tool Configuration
    {
        name: 'delete-portfolio',
        description:
            'Permanently delete one of the user\'s portfolios, including all its transactions; deleting a portfolio with portfolioType "parent" also deletes every linked child account. Irreversible — always name the exact portfolio (from get-portfolio-list) and get explicit user confirmation before calling.',
        endpoint: '/portfolio/{portfolioId}',
        method: 'DELETE',
        paramsInQuery: true,
        parameters: {
            portfolioId: z.string().describe('Id of the portfolio to delete (from get-portfolio-list).'),
        },
    },

    // Currencies Tool Configuration
    {
        name: 'get-currencies',
        description: 'Get a list of fiat currencies supported by CoinStats.',
        endpoint: '/currencies',
        method: 'GET',
        parameters: {},
    },
];
