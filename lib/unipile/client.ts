import { env } from "@/lib/env";

// Thin typed wrapper for Unipile. Auth: `X-API-KEY` header. Base URL is
// derived from the DSN, e.g. https://api43.unipile.com:17337/api/v1/.

export class UnipileError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
  }
}

export interface UnipileClientOpts {
  dsn?: string;
  apiKey?: string;
}

export function createUnipileClient(opts: UnipileClientOpts = {}) {
  const dsn = (opts.dsn ?? env.UNIPILE_DSN ?? "").replace(/^https?:\/\//, "");
  const apiKey = opts.apiKey ?? env.UNIPILE_API_KEY;
  if (!dsn) throw new Error("UNIPILE_DSN is not configured");
  if (!apiKey) throw new Error("UNIPILE_API_KEY is not configured");
  const baseUrl = `https://${dsn}/api/v1`;

  async function request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "X-API-KEY": apiKey!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    const data = text ? safeJSON(text) : null;
    if (!res.ok) {
      throw new UnipileError(
        `Unipile ${method} ${path} -> ${res.status}`,
        res.status,
        data ?? text,
      );
    }
    return data as T;
  }

  return {
    // Accounts (connected LinkedIn / messaging providers)
    listAccounts: () =>
      request<{ items: Array<{ id: string; type: string; name?: string; status?: string }>; cursor?: string | null }>(
        "GET",
        `/accounts`,
      ),

    // Webhooks
    listWebhooks: () => request<{ items: unknown[] }>("GET", `/webhooks`),
    createWebhook: (input: { source: string; request_url: string; events?: string[]; name?: string }) =>
      request<{ id: string }>("POST", `/webhooks`, input),
    deleteWebhook: (id: string) => request<unknown>("DELETE", `/webhooks/${id}`),

    // Chats + messages (LinkedIn)
    listChats: (params: { account_id?: string; cursor?: string; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.account_id) q.set("account_id", params.account_id);
      if (params.cursor) q.set("cursor", params.cursor);
      if (params.limit) q.set("limit", String(params.limit));
      return request<{ items: unknown[]; cursor?: string | null }>(
        "GET",
        `/chats${q.toString() ? `?${q.toString()}` : ""}`,
      );
    },
    listMessages: (chatId: string, params: { cursor?: string; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (params.cursor) q.set("cursor", params.cursor);
      if (params.limit) q.set("limit", String(params.limit));
      return request<{ items: unknown[]; cursor?: string | null }>(
        "GET",
        `/chats/${chatId}/messages${q.toString() ? `?${q.toString()}` : ""}`,
      );
    },
    sendMessage: (chatId: string, input: { text: string }) =>
      request<{ id: string }>("POST", `/chats/${chatId}/messages`, input),

    // Hosted-auth link generation. Returns a URL the user opens to log in
    // to their LinkedIn account on Unipile's UI; once they complete the
    // flow, Unipile registers the account and pushes a webhook event.
    // Caller passes a `name` (workspace label) and `success/failure` URLs
    // to redirect to once done.
    createHostedAuthLink: (input: {
      type: "create"; // creating a new account
      providers: "LINKEDIN" | string;
      api_url: string; // typically the same DSN this client points at
      expiresOn?: string; // ISO-8601
      name?: string;
      success_redirect_url?: string;
      failure_redirect_url?: string;
      notify_url?: string;
    }) => request<{ url: string }>("POST", `/hosted/accounts/link`, input),

    raw: request,
  };
}

function safeJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
