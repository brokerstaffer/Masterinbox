// Placeholder kept so future-us can re-introduce a shared HTTP agent
// without churning import paths. The previous version configured an
// explicit undici Agent (connections: 64) and injected it into every
// Supabase client; that caused Next.js / turbopack to fail bundling
// with "Cannot find module 'node:net': Unsupported external type Url
// for commonjs reference" on routes that imported the chain. Reverted
// to Node's built-in globalThis.fetch — which is undici under the
// hood (default 6 connections per origin). Combined with the TTL
// cache on the heaviest lookup loaders, this keeps page renders
// snappy at our current concurrency.

export const supabaseFetch: typeof fetch | undefined = undefined;
