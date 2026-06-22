// Passthrough layout at the /portal segment so Next.js recognises
// it as a route group with an owner. Required for the sibling
// opengraph-image.png to be auto-attached to every nested page's
// metadata (without a layout/page at this level the file is
// served as a static asset but never referenced in any rendered
// <meta property="og:image">).
//
// No UI logic here — every portal page renders inside the deeper
// app/portal/[token]/layout.tsx with the actual sidebar shell.

export default function PortalSegmentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
