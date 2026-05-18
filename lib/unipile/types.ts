// Unipile webhook payload — for the `messaging` source. Shape per Unipile docs:
//   { event, account_id, chat_id, message_id, sender, ... }
// We model the fields we actually use.

export interface UnipileWebhookEvent {
  event?: string;
  account_id?: string;
  chat_id?: string;
  message_id?: string;
  sender?: {
    attendee_id?: string;
    attendee_name?: string;
    attendee_provider_id?: string;
    profile_url?: string;
  };
  message?: {
    id?: string;
    text?: string;
    timestamp?: string;
    subject?: string | null;
  };
  // Tolerate provider field churn.
  [key: string]: unknown;
}
