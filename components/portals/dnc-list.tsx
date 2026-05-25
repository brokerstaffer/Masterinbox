"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Trash2, Loader2, Ban } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DncEntry } from "@/lib/portals/portal-data";
import {
  PortalPageHeader,
  PortalEmpty,
  Pill,
  Avatar,
  useMounted,
} from "@/components/portals/portal-ui";

export function DncList({
  token,
  entries,
}: {
  token: string;
  entries: DncEntry[];
}) {
  const router = useRouter();
  const mounted = useMounted();
  const [openAdd, setOpenAdd] = useState(false);
  const [search, setSearch] = useState("");

  const agents = useMemo(
    () => entries.filter((e) => e.kind === "agent"),
    [entries],
  );
  const companies = useMemo(
    () => entries.filter((e) => e.kind === "company"),
    [entries],
  );

  const filterFn = (e: DncEntry) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [e.name, e.email, e.brokerage]
      .filter(Boolean)
      .some((v) => v!.toLowerCase().includes(q));
  };

  async function remove(id: string) {
    if (!confirm("Remove from DNC list?")) return;
    const res = await fetch(`/api/portal/${token}/dnc/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PortalPageHeader
        title="Do Not Contact"
        subtitle="Agents and companies we should never reach out to. Adding an email here immediately blocks it on Instantly and EmailBison."
        actions={
          <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
            <Plus className="size-4" />
            Add to DNC
          </Button>
        }
      />

      {entries.length === 0 ? (
        <PortalEmpty
          title="No DNC entries yet"
          hint="Add agents or companies you want excluded from outreach — anyone who unsubscribes is added here automatically too."
          action={
            <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
              <Plus className="size-4" />
              Add the first one
            </Button>
          }
        />
      ) : (
        <>
          <div className="mb-4 flex items-center gap-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9aa0ab]" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search blocklist…"
                className="h-9 w-64 rounded-lg border border-[#ebecf0] bg-white pl-8 pr-3 text-[13px] placeholder:text-[#9aa0ab] focus:border-[#bcd5f1] focus:outline-none focus:ring-2 focus:ring-[#eaf2fd]"
              />
            </div>
            <span className="ml-auto text-[12px] text-[#9aa0ab]">
              {entries.length} blocked
            </span>
          </div>

          <DncSection
            title="Agents"
            count={agents.length}
            entries={agents.filter(filterFn)}
            mounted={mounted}
            onRemove={remove}
          />

          {companies.length > 0 || agents.length === 0 ? (
            <div className="mt-6">
              <DncSection
                title="Companies"
                count={companies.length}
                entries={companies.filter(filterFn)}
                mounted={mounted}
                onRemove={remove}
                companyStyle
              />
            </div>
          ) : null}
        </>
      )}

      {openAdd ? (
        <AddDncDialog
          token={token}
          onClose={() => setOpenAdd(false)}
          onAdded={() => {
            setOpenAdd(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function DncSection({
  title,
  count,
  entries,
  mounted,
  onRemove,
  companyStyle,
}: {
  title: string;
  count: number;
  entries: DncEntry[];
  mounted: boolean;
  onRemove: (id: string) => void;
  companyStyle?: boolean;
}) {
  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        <span className="text-[11px] font-medium text-[#9aa0ab]">{count}</span>
      </div>
      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-[#ebecf0] bg-white shadow-sm transition-opacity duration-500",
          mounted ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="grid grid-cols-[1.5fr_1.2fr_1.4fr_120px_44px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
          <div>{companyStyle ? "Company" : "Agent"}</div>
          <div>{companyStyle ? "" : "Brokerage"}</div>
          <div>Email / phone</div>
          <div>Status</div>
          <div></div>
        </div>
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-[12.5px] text-[#9aa0ab]">
            None matching your search.
          </div>
        ) : (
          <div className="divide-y divide-[#f0f1f4]">
            {entries.map((e) => (
              <div
                key={e.id}
                className="grid grid-cols-[1.5fr_1.2fr_1.4fr_120px_44px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fafbfc]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {companyStyle ? (
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-[#fee2e2] text-[#b91c1c]">
                      <Ban className="size-4" />
                    </div>
                  ) : (
                    <Avatar name={e.name} />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">{e.name}</div>
                    {e.notes ? (
                      <div className="truncate text-[11.5px] text-[#9aa0ab]">{e.notes}</div>
                    ) : null}
                  </div>
                </div>
                <div className="truncate text-[12.5px] text-[#5b6472]">
                  {companyStyle ? "" : (e.brokerage ?? "—")}
                </div>
                <div className="min-w-0 text-[12.5px] text-[#5b6472]">
                  {e.email ? (
                    <div className="truncate">{e.email}</div>
                  ) : null}
                  {e.phone ? (
                    <div className="truncate text-[#9aa0ab]">{e.phone}</div>
                  ) : null}
                  {!e.email && !e.phone ? "—" : null}
                </div>
                <div>
                  <StatusPill entry={e} />
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => onRemove(e.id)}
                    aria-label="Remove"
                    className="inline-flex size-8 items-center justify-center rounded-md text-[#9aa0ab] transition-colors hover:bg-[#fee2e2] hover:text-[#b91c1c]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function StatusPill({ entry }: { entry: DncEntry }) {
  if (!entry.email) {
    return <Pill tone="neutral">No email</Pill>;
  }
  if (entry.push_error) {
    return (
      <Pill tone="warning" className="cursor-help" >
        <span title={entry.push_error}>Push failed</span>
      </Pill>
    );
  }
  if (entry.pushed_to_instantly || entry.pushed_to_emailbison) {
    return <Pill tone="success">Blocked</Pill>;
  }
  return <Pill tone="neutral">Pending</Pill>;
}

function AddDncDialog({
  token,
  onClose,
  onAdded,
}: {
  token: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [kind, setKind] = useState<"agent" | "company">("agent");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [brokerage, setBrokerage] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  async function save() {
    if (!name.trim()) {
      toast.error("Add a name");
      return;
    }
    const res = await fetch(`/api/portal/${token}/dnc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        name: name.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        brokerage: brokerage.trim() || null,
        notes: notes.trim() || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Save failed");
      return;
    }
    const j = await res.json().catch(() => ({}));
    if (j.pushedInstantly || j.pushedEmailBison) {
      toast.success("Added · pushed to provider blocklists");
    } else if (email.trim()) {
      toast.success("Added · provider push pending");
    } else {
      toast.success("Added");
    }
    startTransition(() => onAdded());
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add to DNC list</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="inline-flex rounded-md border border-[#ebecf0] bg-[#fafbfc] p-0.5 text-[12.5px]">
            {(["agent", "company"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  "rounded-[5px] px-3 py-1 font-medium capitalize transition-colors",
                  kind === k
                    ? "bg-white text-[#0f1320] shadow-sm"
                    : "text-[#5b6472] hover:text-[#0f1320]",
                )}
              >
                {k === "agent" ? "Agent" : "Company"}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              {kind === "agent" ? "Agent name" : "Company name"}
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "agent" ? "Jane Smith" : "Acme Realty"}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="optional"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Phone</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="optional"
              />
            </div>
          </div>
          {kind === "agent" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Brokerage</label>
              <Input
                value={brokerage}
                onChange={(e) => setBrokerage(e.target.value)}
                placeholder="optional"
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="optional"
              rows={2}
            />
          </div>
          <p className="text-[11px] leading-relaxed text-[#9aa0ab]">
            If you supply an email, it&apos;s pushed to Instantly and EmailBison
            blocklists immediately — the sequencer stops emailing them.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
