import { Agent, fetch as undiciFetch } from "undici";

// Shared HTTP connection pool for every Supabase request.
//
// Node's default fetch dispatcher allows only 6 concurrent connections per
// origin. With 5+ reply managers open at once each rendering an inbox page
// that fires ~9 parallel Supabase queries, requests queue 6-deep and page
// loads balloon from ~400ms to multi-second. Bumping the pool to 64 keeps
// real traffic well below saturation.
//
// `keepAliveTimeout` plus `pipelining: 0` make sure we reuse TCP/TLS
// connections (no handshake per query) without enabling HTTP/1.1
// pipelining (which Supabase's edge doesn't tolerate well).
const agent = new Agent({
  connections: 64,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 0,
});

// Drop-in `fetch` that routes through the shared agent. Supabase JS lets us
// inject this via the `global.fetch` option on every client instance.
export const supabaseFetch: typeof fetch = (input, init) => {
  // undici's fetch types are a near-superset of the DOM fetch — cast for
  // Supabase's typings (which expect the DOM form).
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: agent },
  ) as unknown as Promise<Response>;
};
