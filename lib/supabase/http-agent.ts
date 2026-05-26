import { Agent, fetch as undiciFetch } from "undici";

// Shared HTTP connection pool for every Supabase request.
//
// Default Node fetch allows only 6 concurrent connections per origin —
// that becomes the bottleneck when 5+ reply managers render the inbox
// at once. Bumping the pool to 64 keeps real traffic well below
// saturation.
//
// Aggressive timeouts are CRITICAL: without them, a single stuck
// upstream socket can hang a request forever, which (when combined
// with our request-deduping TTL cache) poisons every subsequent
// caller for the same workspace. The portal "this page couldn't
// load" regression came from exactly that scenario.
//
//   - headersTimeout (15s): kill the request if Supabase doesn't even
//     start responding within 15s. Supabase REST normally answers in
//     <100ms over the us-east-1 ↔ us-east4 path; 15s is the panic
//     threshold.
//   - bodyTimeout (30s): kill the request if the response body takes
//     more than 30s to stream in. Pages that legitimately stream
//     large blobs (e.g. CSV export) go through their own routes, not
//     this agent's defaults.
//   - keepAliveTimeout (30s) + keepAliveMaxTimeout (60s): reuse TCP/
//     TLS without holding idle sockets indefinitely. Idle sockets
//     past keepAliveTimeout get recycled — guards against silent
//     middlebox drops.

const agent = new Agent({
  connections: 64,
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  headersTimeout: 15_000,
  bodyTimeout: 30_000,
  pipelining: 0,
});

// Drop-in `fetch` that routes through the shared agent. Supabase JS
// lets us inject this via the `global.fetch` option on every client
// instance.
export const supabaseFetch: typeof fetch = (input, init) => {
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    { ...(init as Parameters<typeof undiciFetch>[1]), dispatcher: agent },
  ) as unknown as Promise<Response>;
};
