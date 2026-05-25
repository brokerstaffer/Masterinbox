import { redirect } from "next/navigation";

// The Recruiting Pipeline lives at the portal root now (see migration
// 0027 + the page.tsx redesign that merged Introductions and Pipeline
// into one surface). This route exists only so old bookmarks keep
// resolving.

export default async function PipelineLegacyRedirect(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  redirect(`/portal/${token}`);
}
