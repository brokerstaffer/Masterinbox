import { InboxSkeleton } from "@/components/inbox/inbox-skeleton";

// Instant skeleton when navigating to a list view (tab/filter/list
// switch) before its loaders resolve. Also covers nested thread routes
// that don't supply their own loading boundary.
export default function Loading() {
  return <InboxSkeleton />;
}
