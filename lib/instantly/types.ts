// Instantly.ai v2 API — types observed live against api.instantly.ai/api/v2.
//
// Auth: Authorization: Bearer <key>. The key is a base64 string in the form
// `id:secret`; send the encoded string as-is (DO NOT decode).
//
// Cursor pagination: requests take `limit` (max 100) and `starting_after`;
// responses include `items[]` and `next_starting_after` (absent on last page).
//
// Webhooks: live `reply_received` event fires per inbound reply. There is no
// HMAC signature on the payload — verify with a URL token (same pattern as
// our EmailBison webhook) and/or re-fetch the email by id to confirm.

export interface InstantlyAddress {
  name?: string;
  address: string;
}

export interface InstantlyEmail {
  id: string;                  // UUID
  timestamp_created?: string;
  timestamp_email?: string;
  message_id?: string;         // RFC 2822 Message-ID
  subject?: string | null;

  from_address_email?: string | null;
  from_address_json?: InstantlyAddress[];

  // `to_address_email_list` is a CSV string in some responses, JSON array in others.
  to_address_email_list?: string | null;
  to_address_json?: InstantlyAddress[];
  cc_address_email_list?: string | null;
  cc_address_json?: InstantlyAddress[];
  bcc_address_email_list?: string | null;
  bcc_address_json?: InstantlyAddress[];

  eaccount?: string;           // mailbox identity inside Instantly (= our sender)
  campaign_id?: string | null;
  lead?: string | null;        // lead email
  lead_id?: string | null;     // lead UUID
  thread_id?: string;          // Instantly's thread grouping (opaque string)

  ue_type?: number;            // 1 = sent (outbound), 2 = received (inbound)
  is_unread?: number | boolean;
  is_focused?: number | boolean;
  i_status?: number;           // internal lead interest code (negative = not interested)
  step?: string;

  content_preview?: string;
  body?: {
    text?: string;
    html?: string;
  };
}

export interface InstantlyCampaign {
  id: string;
  name: string;
  status?: number;             // 0=draft,1=active,2=paused,3=completed,4=stopped
  timestamp_created?: string;
  timestamp_updated?: string;
  organization?: string;
  daily_limit?: number;
  stop_on_reply?: boolean;
}

// Live-verified shape. Quirk: the POST endpoint requires `target_hook_url`
// (not `webhook_url`) and a singular `event_type` string (not the plural
// `event_types` array shown in marketing docs). The GET response uses the
// same names — there's only one event_type per webhook, so multi-event
// subscriptions require multiple webhook rows.
export interface InstantlyWebhook {
  id: string;
  name?: string;
  target_hook_url: string;
  event_type: string;
  organization?: string;
  status?: number;
  timestamp_created?: string;
}

// Subset of the live event list we care about for sync. The full list also
// includes email_sent, email_opened, email_bounced, account_error, plus
// `custom_label_any_positive` / `custom_label_any_negative` for custom labels.
export type InstantlyEventType =
  | "reply_received"
  | "lead_interested"
  | "lead_not_interested"
  | "lead_neutral"
  | "lead_meeting_booked"
  | "lead_meeting_completed"
  | "lead_closed"
  | "lead_out_of_office"
  | "lead_wrong_person"
  | "lead_unsubscribed"
  | "campaign_completed";

// Events to subscribe to for inbox sync. Mirror of EmailBison's RELEVANT_EVENTS.
// Other lead_* events change interest status; we'll surface those as labels
// later. For now, sync only the actual reply payload.
export const RELEVANT_EVENTS: InstantlyEventType[] = ["reply_received"];

// Webhook envelope shape. Instantly does not publish an exhaustive schema for
// each event type; the payload includes the event_type and the relevant
// entity (email / lead / campaign) inline. We accept it as a loose object
// and pull out what we need.
export interface InstantlyWebhookEnvelope {
  event_type?: InstantlyEventType | string;
  timestamp?: string;
  webhook_id?: string;

  // Inbound reply payloads include the email object.
  email?: InstantlyEmail;
  // Some events also carry a lead reference (without the full email body).
  lead?: {
    id?: string;
    email?: string;
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    campaign?: string | null;
  };
  campaign?: { id?: string; name?: string };

  // Catch-all for fields we don't model yet.
  [key: string]: unknown;
}
