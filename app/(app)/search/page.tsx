import Link from "next/link";
import { Mail, Search as SearchIcon } from "lucide-react";
import { requireSession } from "@/lib/auth/workspace";
import { searchThreads } from "@/lib/inbox/search";

// Full search results page. The top-bar search box routes here on Enter
// ("show me everything that matches"), vs. the inline dropdown which is
// capped at 10 quick hits.
export const dynamic = "force-dynamic";

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireSession();
  const { q } = await props.searchParams;
  const query = (q ?? "").trim();
  const results =
    query.length >= 2
      ? await searchThreads(session.activeWorkspace.id, query, 200)
      : [];

  return (
    <div className="flex-1 overflow-y-auto bg-[#f4f7fb]">
      <div className="max-w-3xl mx-auto px-8 py-8">
        <div className="flex items-center gap-2.5 mb-1">
          <SearchIcon className="size-5 text-[#5b6370]" />
          <h1 className="text-xl font-semibold tracking-tight">
            {query ? <>Results for &ldquo;{query}&rdquo;</> : "Search"}
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          {query.length < 2
            ? "Type at least 2 characters in the search box above."
            : `${results.length} conversation${results.length === 1 ? "" : "s"} match — across names, emails, companies, subjects, campaigns, client names and message text.`}
        </p>

        {query.length >= 2 && results.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-12 text-center text-sm text-muted-foreground">
            Nothing matched &ldquo;{query}&rdquo;.
          </div>
        ) : (
          <div className="rounded-xl border bg-card overflow-hidden divide-y">
            {results.map((hit) => {
              const name = hit.lead_full_name || hit.lead_email || "Unknown";
              const meta = [hit.lead_email, hit.lead_company]
                .filter(Boolean)
                .join(" · ");
              return (
                <Link
                  key={hit.id}
                  href={`/inbox/all-email/${hit.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-accent transition-colors"
                >
                  <div className="size-8 rounded-md bg-zinc-100 text-zinc-700 flex items-center justify-center shrink-0">
                    <Mail className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{name}</div>
                    {meta ? (
                      <div className="text-xs text-muted-foreground truncate">
                        {meta}
                      </div>
                    ) : null}
                  </div>
                  <div className="hidden sm:block min-w-0 max-w-[34%] text-right">
                    <div className="text-xs text-foreground/80 truncate">
                      {hit.subject ?? "(no subject)"}
                    </div>
                    {hit.client_name ? (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {hit.client_name}
                      </div>
                    ) : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
