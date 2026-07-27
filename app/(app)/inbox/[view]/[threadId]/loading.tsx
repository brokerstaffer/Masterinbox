import { InboxSkeleton } from "@/components/inbox/inbox-skeleton";

// Rendered instantly by Next on every navigation into a thread — both a
// fresh open and a switch from one thread to another — while the server
// loaders + RSC transfer complete. Turns a frozen multi-second wait into
// an immediate response.
export default function Loading() {
  return <InboxSkeleton />;
}
