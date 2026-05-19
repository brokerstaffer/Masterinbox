// Pure type shared by server + client. No server-only imports.

export interface ChannelRow {
  id: string;
  display_name: string | null;
  provider: "emailbison" | "instantly" | null;
  type: "email" | null;
}
