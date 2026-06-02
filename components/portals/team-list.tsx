"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Trash2,
  Loader2,
  Pencil,
  Mail,
  Upload,
  Download,
  Search,
  FileText,
} from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { TeamMember } from "@/lib/portals/portal-data";
import { formatPhoneDisplay } from "@/lib/portals/phone";
import {
  parseCsv,
  csvRowToTeam,
  toCsv,
  downloadCsv,
  type TeamRow,
} from "@/lib/portals/csv";
import {
  PortalPageHeader,
  PortalEmpty,
  Avatar,
  useMounted,
  PaginationFooter,
  PORTAL_PAGE_SIZE,
  SelectAllAcrossPagesBanner,
} from "@/components/portals/portal-ui";

// Team is the intro-notification roster — NOT a blocklist (that's
// DNC + Your Agents). When a warm introduction is ready, we create an
// email thread that addresses the active members below. The page used
// to push every team email to Instantly + EmailBison blocklists too;
// that behavior was removed in 2026-05 per client feedback.
//
// Layout mirrors the client's mockup (team-section HTML):
//   - Gradient blue "How intro delivery works" banner
//   - Inline collapsible Add-member form (NOT a modal — modal stays
//     reserved for Edit only, matching the mockup's two-mode pattern)
//   - Member rows show a colored-initial avatar + small green/gray
//     status dot bottom-right of the avatar

export function TeamList({
  token,
  members: initial,
}: {
  token: string;
  members: TeamMember[];
}) {
  const router = useRouter();
  const mounted = useMounted();
  const [members, setMembers] = useState(initial);
  useEffect(() => setMembers(initial), [initial]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<TeamMember | null>(null);
  const [openCsv, setOpenCsv] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search.trim()) return members;
    const q = search.trim().toLowerCase();
    return members.filter((m) =>
      [m.name, m.email, m.title]
        .filter((v): v is string => Boolean(v))
        .some((v) => v.toLowerCase().includes(q)),
    );
  }, [members, search]);
  useEffect(() => setPage(1), [search]);
  const pageItems = useMemo(() => {
    const start = (page - 1) * PORTAL_PAGE_SIZE;
    return filtered.slice(start, start + PORTAL_PAGE_SIZE);
  }, [filtered, page]);

  async function patch(id: string, body: Partial<TeamMember>) {
    const res = await fetch(`/api/portal/${token}/team/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Update failed");
      router.refresh();
      return false;
    }
    return true;
  }

  function setActive(id: string, active: boolean) {
    setMembers((cur) => cur.map((m) => (m.id === id ? { ...m, active } : m)));
    void patch(id, { active });
  }
  async function remove(id: string, name: string) {
    if (!confirm(`Remove ${name}?`)) return;
    const res = await fetch(`/api/portal/${token}/team/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  // Bulk-select helpers — same shape as the Agents list so the JSX
  // for the bulk-action bar / banner / per-row checkbox stays
  // copy-pasteable and behaves identically.
  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisible() {
    setSelected((cur) => {
      const visibleIds = pageItems.map((m) => m.id);
      const allSelected = visibleIds.every((id) => cur.has(id));
      const next = new Set(cur);
      if (allSelected) for (const id of visibleIds) next.delete(id);
      else for (const id of visibleIds) next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }

  function exportRows(rows: TeamMember[], filenameSuffix: string) {
    if (rows.length === 0) {
      toast.info("Nothing to export");
      return;
    }
    const csv = toCsv(
      rows.map((m) => ({
        name: m.name,
        email: m.email,
        title: m.title ?? "",
        phone: m.phone ?? "",
      })),
      ["name", "email", "title", "phone"],
    );
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`team-${filenameSuffix}-${today}.csv`, csv);
  }
  function exportCsv() {
    exportRows(filtered, "all");
  }
  function bulkExport() {
    exportRows(
      members.filter((m) => selected.has(m.id)),
      "selected",
    );
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Remove ${selected.size} team member(s)?`)) return;
    const ids = Array.from(selected);
    // Optimistic — drop the rows now so the table updates immediately.
    setMembers((cur) => cur.filter((m) => !selected.has(m.id)));
    clearSelection();
    // Same 300-id chunk size the Agents list uses — keeps every
    // PostgREST .in("id", …) URL under Node's 16 KB header cap.
    const CHUNK = 300;
    let deleted = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const res = await fetch(`/api/portal/${token}/team/bulk-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: slice }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? "Bulk delete failed");
        router.refresh();
        return;
      }
      const j = await res.json().catch(() => ({}));
      deleted += (j.deleted as number | undefined) ?? slice.length;
    }
    toast.success(`Removed ${deleted.toLocaleString()}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PortalPageHeader
        title="Team"
        subtitle="Who receives intro notifications and how."
        actions={
          <>
            <Button
              variant="outline"
              onClick={exportCsv}
              className="gap-1.5"
              disabled={members.length === 0}
            >
              <Download className="size-4" />
              Export CSV
            </Button>
            <Button variant="outline" onClick={() => setOpenCsv(true)} className="gap-1.5">
              <Upload className="size-4" />
              Import CSV
            </Button>
            <Button onClick={() => setShowAddForm((v) => !v)} className="gap-1.5">
              <Plus className="size-4" />
              Add member
            </Button>
          </>
        }
      />

      {/* How intro delivery works — gradient banner, matches mockup */}
      <div className="mb-6 flex items-start gap-4 rounded-2xl border border-[#c7d2fe] bg-gradient-to-br from-[#eef3ff] to-[#e8ecff] px-5 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#1a5cf8] text-white">
          <Mail className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-[#1e3a8a]">
            How intro delivery works
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#3730a3]">
            When a warm introduction is ready, BrokerStaffer creates an
            email thread and introduces the agent directly to the active
            recipients below.
          </p>
        </div>
      </div>

      {/* Collapsible inline Add-member form — shown when "Add member"
          is clicked, hidden otherwise. Matches the mockup's pattern of
          inline form for Add + modal for Edit. */}
      {showAddForm ? (
        <AddMemberForm
          token={token}
          onCancel={() => setShowAddForm(false)}
          onAdded={() => {
            setShowAddForm(false);
            router.refresh();
          }}
        />
      ) : null}

      {members.length === 0 ? (
        <PortalEmpty
          title="No team members yet"
          hint="Add the people who should hear about every introduction."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenCsv(true)} className="gap-1.5">
                <Upload className="size-4" />
                Import CSV
              </Button>
              <Button onClick={() => setShowAddForm(true)} className="gap-1.5">
                <Plus className="size-4" />
                Add the first member
              </Button>
            </div>
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
                placeholder="Search team…"
                className="h-9 w-64 rounded-lg border border-[#ebecf0] bg-white pl-8 pr-3 text-[13px] placeholder:text-[#9aa0ab] focus:border-[#bcd5f1] focus:outline-none focus:ring-2 focus:ring-[#eaf2fd]"
              />
            </div>
            <span className="ml-auto text-[12px] text-[#9aa0ab]">
              {filtered.length.toLocaleString()} of {members.length.toLocaleString()}
            </span>
          </div>

          {/* Bulk-action bar — same shape as the Agents list so the
              UX stays uniform across portal pages. */}
          <div
            className={cn(
              "mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2",
              selected.size > 0 ? "border-[#bcd5f1] bg-[#eaf2fd]/60" : "border-[#ebecf0] bg-white",
            )}
          >
            <span
              className={cn(
                "text-[13px] font-medium",
                selected.size > 0 ? "text-[#1565C0]" : "text-[#5b6472]",
              )}
            >
              {selected.size > 0
                ? `${selected.size} selected`
                : "Bulk actions — tick rows below to enable"}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={bulkExport}
                disabled={selected.size === 0}
                className="gap-1.5 h-8"
              >
                <Download className="size-3.5" />
                Export selected
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={bulkDelete}
                disabled={selected.size === 0}
                className={cn(
                  "gap-1.5 h-8",
                  selected.size > 0
                    ? "border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                    : "",
                )}
              >
                <Trash2 className="size-3.5" />
                Delete selected
              </Button>
              {selected.size > 0 ? (
                <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8">
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>

          <SelectAllAcrossPagesBanner
            visiblePageFullySelected={
              pageItems.length > 0 && pageItems.every((m) => selected.has(m.id))
            }
            selectedCount={selected.size}
            totalCount={filtered.length}
            noun="members"
            onSelectAll={() => setSelected(new Set(filtered.map((m) => m.id)))}
            onClear={clearSelection}
          />

        <div
          className={cn(
            "overflow-x-auto rounded-2xl border border-[#ebecf0] bg-white shadow-sm transition-opacity duration-500",
            mounted ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="grid min-w-[680px] grid-cols-[36px_1.4fr_1.1fr_1.6fr_72px_84px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
            <div className="flex items-center justify-center">
              <input
                type="checkbox"
                aria-label="Select all visible"
                checked={
                  pageItems.length > 0 && pageItems.every((m) => selected.has(m.id))
                }
                onChange={toggleAllVisible}
                className="size-3.5 cursor-pointer accent-[#1565C0]"
              />
            </div>
            <div>Member</div>
            <div>Title</div>
            <div>Email / Phone</div>
            <div className="text-center">Active</div>
            <div></div>
          </div>
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-[12.5px] text-[#9aa0ab]">
              No members match your search.
            </div>
          ) : (
          <div className="divide-y divide-[#f0f1f4]">
            {pageItems.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "grid min-w-[680px] grid-cols-[36px_1.4fr_1.1fr_1.6fr_72px_84px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fafbfc]",
                  !m.active && "opacity-60",
                  selected.has(m.id) && "bg-[#eaf2fd]/40 hover:bg-[#eaf2fd]/60",
                )}
              >
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`Select ${m.name}`}
                    checked={selected.has(m.id)}
                    onChange={() => toggleOne(m.id)}
                    className="size-3.5 cursor-pointer accent-[#1565C0]"
                  />
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <div className="relative shrink-0">
                    <Avatar name={m.name} />
                    {/* Small status dot bottom-right of avatar —
                        green when active, grey when paused. Matches
                        the mockup's at-a-glance status pattern. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-white",
                        m.active ? "bg-[#10b981]" : "bg-[#d1d5db]",
                      )}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">{m.name}</div>
                  </div>
                </div>
                <div className="truncate text-[13px] text-[#5b6472]">
                  {m.title ?? "—"}
                </div>
                <div className="min-w-0 text-[12.5px] text-[#5b6472]">
                  <div className="truncate">{m.email}</div>
                  {m.phone ? (
                    <div className="truncate text-[#9aa0ab]">{formatPhoneDisplay(m.phone)}</div>
                  ) : null}
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={m.active}
                    onCheckedChange={(v) => setActive(m.id, Boolean(v))}
                    aria-label="Active"
                  />
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(m)}
                    aria-label="Edit"
                    className="inline-flex size-8 items-center justify-center rounded-md text-[#9aa0ab] transition-colors hover:bg-[#eaf2fd] hover:text-[#1565C0]"
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(m.id, m.name)}
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

        <PaginationFooter
          page={page}
          pageSize={PORTAL_PAGE_SIZE}
          total={filtered.length}
          onPageChange={setPage}
          label="members"
        />
        </>
      )}

      {editing ? (
        <EditMemberDialog
          token={token}
          member={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {openCsv ? (
        <TeamCsvImportDialog
          token={token}
          onClose={() => setOpenCsv(false)}
          onImported={() => {
            setOpenCsv(false);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

// Inline collapsible Add form rendered between the explainer banner and
// the table. Mirrors the mockup's 3-col-then-1 row layout.
function AddMemberForm({
  token,
  onCancel,
  onAdded,
}: {
  token: string;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [pending, startTransition] = useTransition();

  async function save() {
    if (!name.trim()) {
      toast.error("Add a name");
      return;
    }
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    const res = await fetch(`/api/portal/${token}/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        title: title.trim() || null,
        phone: phone.trim() || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Save failed");
      return;
    }
    toast.success("Member added");
    startTransition(() => onAdded());
  }

  return (
    <div className="mb-5 rounded-2xl border border-[#eaecf0] bg-white p-5 shadow-sm">
      <div className="mb-3.5 text-[13px] font-semibold tracking-tight">
        Add team member
      </div>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#c0c7d4]">
            Full name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Maria Lopez"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#c0c7d4]">
            Title
          </label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Recruiting Manager"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#c0c7d4]">
            Email
          </label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@brokerage.com"
          />
        </div>
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#c0c7d4]">
            Phone
          </label>
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(305) 555-0000"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={pending || !name.trim() || !email.trim()}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : "Add member"}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function EditMemberDialog({
  token,
  member,
  onClose,
  onSaved,
}: {
  token: string;
  member: TeamMember;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);
  const [title, setTitle] = useState(member.title ?? "");
  const [phone, setPhone] = useState(member.phone ?? "");
  const [pending, startTransition] = useTransition();

  async function save() {
    if (!name.trim()) {
      toast.error("Add a name");
      return;
    }
    if (!email.trim()) {
      toast.error("Email is required");
      return;
    }
    const res = await fetch(`/api/portal/${token}/team/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        email: email.trim(),
        title: title.trim() || null,
        phone: phone.trim() || null,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Save failed");
      return;
    }
    toast.success("Member updated");
    startTransition(() => onSaved());
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Full name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Recruiting Manager"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Phone</label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="(305) 555-0000"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim() || !email.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// CSV import for Team — same UX shape the Agents importer uses
// (parse client-side, preview the first 50 rows, post the whole set
// to /team/csv in a single request). Server-side dedup happens on
// (client_id, lower(email)) via the unique index added in 0042.
function TeamCsvImportDialog({
  token,
  onClose,
  onImported,
}: {
  token: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<TeamRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  function handleFile(file: File | undefined | null) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const parsed = parseCsv(text);
      const mapped = parsed.map(csvRowToTeam).filter((r): r is TeamRow => Boolean(r));
      setRows(mapped);
    };
    reader.readAsText(file);
  }

  async function submit() {
    if (!rows || rows.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/${token}/team/csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error ?? "Import failed");
        setSubmitting(false);
        return;
      }
      setImportedCount(j.inserted ?? rows.length);
      toast.success(`${j.inserted ?? rows.length} members imported`);
      onImported();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import team members from CSV</DialogTitle>
        </DialogHeader>
        {!rows ? (
          <div>
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#ebecf0] bg-[#fafbfc] px-6 py-12 text-center transition-colors hover:border-[#bcd5f1] hover:bg-[#f4f8fd]"
            >
              <FileText className="size-7 text-[#aab0ba]" />
              <div className="text-sm font-medium">Click to choose a CSV file</div>
              <div className="text-[12px] text-[#9aa0ab]">
                Columns we recognise: <code>name</code>, <code>email</code>,{" "}
                <code>title</code>, <code>phone</code>
                <br />
                Headers don&apos;t need to match exactly — e.g.{" "}
                <code>Full Name</code>, <code>Email Address</code>,{" "}
                <code>Job Title</code>, <code>Phone Number</code> all work.
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between text-[12px]">
              <span className="font-medium">
                {fileName} —{" "}
                <span className="text-[#5b6472]">{rows.length} ready to import</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setRows(null);
                  setFileName(null);
                }}
                className="text-[#1565C0] hover:underline"
              >
                Choose a different file
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto rounded-lg border border-[#ebecf0]">
              <div className="grid grid-cols-[1.4fr_1.4fr_1fr_140px] border-b border-[#ebecf0] bg-[#fafbfc] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
                <div>Name</div>
                <div>Email</div>
                <div>Title</div>
                <div>Phone</div>
              </div>
              {rows.slice(0, 50).map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1.4fr_1.4fr_1fr_140px] gap-2 border-b border-[#f0f1f4] px-3 py-1.5 text-[12.5px] last:border-0"
                >
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-[#5b6472]">{r.email}</div>
                  <div className="truncate text-[#5b6472]">{r.title ?? "—"}</div>
                  <div className="truncate text-[#5b6472]">{r.phone ? formatPhoneDisplay(r.phone) : "—"}</div>
                </div>
              ))}
              {rows.length > 50 ? (
                <div className="px-3 py-1.5 text-center text-[11.5px] text-[#9aa0ab]">
                  …and {rows.length - 50} more
                </div>
              ) : null}
            </div>
            {importedCount !== null ? (
              <p className="mt-3 rounded-md bg-[#e9f7ef] px-3 py-2 text-[12px] text-[#0c8a4e]">
                Imported {importedCount.toLocaleString()} members. Duplicates
                were skipped automatically.
              </p>
            ) : (
              <p className="mt-3 text-[11.5px] leading-relaxed text-[#9aa0ab]">
                Re-uploading the same file is safe — members with the same
                email are skipped automatically.
              </p>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {importedCount !== null ? "Close" : "Cancel"}
          </Button>
          {rows && importedCount === null ? (
            <Button onClick={submit} disabled={submitting || rows.length === 0}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                `Import ${rows.length} members`
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
