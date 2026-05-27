"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Trash2,
  Loader2,
  Ban,
  Upload,
  FileText,
  Pencil,
  Download,
  Users,
  Building2,
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DncEntry } from "@/lib/portals/portal-data";
import {
  parseCsv,
  csvRowToDnc,
  toCsv,
  downloadCsv,
  type DncRow,
} from "@/lib/portals/csv";
import {
  PortalPageHeader,
  PortalEmpty,
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
  const [openCsv, setOpenCsv] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DncEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  function exportRows(rows: DncEntry[], filenameSuffix: string) {
    if (rows.length === 0) {
      toast.info("Nothing to export");
      return;
    }
    const csv = toCsv(
      rows.map((e) => ({
        kind: e.kind,
        name: e.name,
        email: e.email ?? "",
        phone: e.phone ?? "",
        brokerage: e.brokerage ?? "",
        domain: e.domain ?? "",
        notes: e.notes ?? "",
      })),
      ["kind", "name", "email", "phone", "brokerage", "domain", "notes"],
    );
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`dnc-${filenameSuffix}-${today}.csv`, csv);
  }

  function exportCsv() {
    exportRows(entries.filter(filterFn), "all");
  }

  // Selection — shared across both Agents and Companies sections. Same
  // shape as the Your Agents list so the bulk action bar JSX can be
  // copy-pasted without diverging.
  function toggleOne(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllVisibleIn(rows: DncEntry[]) {
    setSelected((cur) => {
      const ids = rows.map((e) => e.id);
      const allSelected = ids.every((id) => cur.has(id));
      const next = new Set(cur);
      if (allSelected) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Remove ${selected.size} entry(ies) from DNC?`)) return;
    const res = await fetch(`/api/portal/${token}/dnc/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: Array.from(selected) }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Bulk delete failed");
      return;
    }
    const j = await res.json().catch(() => ({}));
    toast.success(`Removed ${j.deleted ?? selected.size}`);
    clearSelection();
    router.refresh();
  }
  function bulkExport() {
    exportRows(
      entries.filter((e) => selected.has(e.id)),
      "selected",
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PortalPageHeader
        title="Do Not Contact"
        subtitle="Agents and companies we should never reach out to."
        actions={
          <>
            <Button
              variant="outline"
              onClick={exportCsv}
              className="gap-1.5"
              disabled={entries.length === 0}
            >
              <Download className="size-4" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => setOpenCsv(true)}
              className="gap-1.5"
            >
              <Upload className="size-4" />
              Import CSV
            </Button>
            <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
              <Plus className="size-4" />
              Add to DNC
            </Button>
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3">
        <DncStatCard
          icon={Users}
          label="DNC Agents"
          value={agents.length}
          hint="never contacted across campaigns"
          accent
        />
        <DncStatCard
          icon={Building2}
          label="DNC Companies"
          value={companies.length}
          hint="entire firms excluded from outreach"
        />
      </div>

      {entries.length === 0 ? (
        <PortalEmpty
          title="No DNC entries yet"
          hint="Add agents or companies you want excluded from outreach — anyone who unsubscribes is added here automatically too."
          action={
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setOpenCsv(true)}
                className="gap-1.5"
              >
                <Upload className="size-4" />
                Import CSV
              </Button>
              <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
                <Plus className="size-4" />
                Add the first one
              </Button>
            </div>
          }
        />
      ) : (
        <>
          {selected.size > 0 ? (
            <div className="mb-4 flex items-center gap-3 rounded-lg border border-[#bcd5f1] bg-[#eaf2fd]/60 px-3 py-2">
              <span className="text-[13px] font-medium text-[#1565C0]">
                {selected.size} selected
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={bulkExport}
                  className="gap-1.5 h-8"
                >
                  <Download className="size-3.5" />
                  Export selected
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={bulkDelete}
                  className="gap-1.5 h-8 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
                >
                  <Trash2 className="size-3.5" />
                  Delete selected
                </Button>
                <Button variant="ghost" size="sm" onClick={clearSelection} className="h-8">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mb-4 flex items-center gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[#9aa0ab]" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search agents or companies…"
                  className="h-9 w-64 rounded-lg border border-[#ebecf0] bg-white pl-8 pr-3 text-[13px] placeholder:text-[#9aa0ab] focus:border-[#bcd5f1] focus:outline-none focus:ring-2 focus:ring-[#eaf2fd]"
                />
              </div>
            </div>
          )}

          <DncSection
            title="Agents"
            count={agents.length}
            entries={agents.filter(filterFn)}
            mounted={mounted}
            onRemove={remove}
            onEdit={setEditing}
            selected={selected}
            onToggleOne={toggleOne}
            onToggleAllVisible={toggleAllVisibleIn}
          />

          {companies.length > 0 || agents.length === 0 ? (
            <div className="mt-6">
              <DncSection
                title="Companies"
                count={companies.length}
                entries={companies.filter(filterFn)}
                mounted={mounted}
                onRemove={remove}
                onEdit={setEditing}
                selected={selected}
                onToggleOne={toggleOne}
                onToggleAllVisible={toggleAllVisibleIn}
                companyStyle
              />
            </div>
          ) : null}
        </>
      )}

      {openAdd ? (
        <DncDialog
          token={token}
          entry={null}
          onClose={() => setOpenAdd(false)}
          onSaved={() => {
            setOpenAdd(false);
            router.refresh();
          }}
        />
      ) : null}
      {editing ? (
        <DncDialog
          token={token}
          entry={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {openCsv ? (
        <CsvImportDialog
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

function DncStatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Users;
  label: string;
  value: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border bg-white p-5 shadow-sm",
        accent ? "border-[#d4e4f8]" : "border-[#ebecf0]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
          {label}
        </span>
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            accent ? "bg-[#eaf2fd] text-[#1565C0]" : "bg-[#f6f7f9] text-[#aab0ba]",
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      <div
        className={cn(
          "mt-3 text-3xl font-semibold leading-none tracking-tight tabular-nums",
          accent ? "text-[#1565C0]" : "text-[#0f1320]",
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[11.5px] text-[#9aa0ab]">{hint}</div>
    </div>
  );
}

function DncSection({
  title,
  count,
  entries,
  mounted,
  onRemove,
  onEdit,
  selected,
  onToggleOne,
  onToggleAllVisible,
  companyStyle,
}: {
  title: string;
  count: number;
  entries: DncEntry[];
  mounted: boolean;
  onRemove: (id: string) => void;
  onEdit: (entry: DncEntry) => void;
  selected: Set<string>;
  onToggleOne: (id: string) => void;
  onToggleAllVisible: (rows: DncEntry[]) => void;
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
        <div className="grid grid-cols-[36px_1.5fr_1.2fr_1.6fr_84px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
          <div className="flex items-center justify-center">
            <input
              type="checkbox"
              aria-label={`Select all ${title}`}
              checked={
                entries.length > 0 && entries.every((e) => selected.has(e.id))
              }
              onChange={() => onToggleAllVisible(entries)}
              className="size-3.5 cursor-pointer accent-[#1565C0]"
            />
          </div>
          <div>{companyStyle ? "Company" : "Agent"}</div>
          <div>{companyStyle ? "" : "Brokerage"}</div>
          <div>Email / phone</div>
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
                className={cn(
                  "grid grid-cols-[36px_1.5fr_1.2fr_1.6fr_84px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fafbfc]",
                  selected.has(e.id) && "bg-[#eaf2fd]/40 hover:bg-[#eaf2fd]/60",
                )}
              >
                <div className="flex items-center justify-center">
                  <input
                    type="checkbox"
                    aria-label={`Select ${e.name}`}
                    checked={selected.has(e.id)}
                    onChange={() => onToggleOne(e.id)}
                    className="size-3.5 cursor-pointer accent-[#1565C0]"
                  />
                </div>
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
                  {companyStyle && e.domain ? (
                    <div className="truncate font-medium">{e.domain}</div>
                  ) : null}
                  {e.email ? (
                    <div className="truncate">{e.email}</div>
                  ) : null}
                  {e.phone ? (
                    <div className="truncate text-[#9aa0ab]">{e.phone}</div>
                  ) : null}
                  {!e.email && !e.phone && !(companyStyle && e.domain)
                    ? "—"
                    : null}
                </div>
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => onEdit(e)}
                    aria-label="Edit"
                    className="inline-flex size-8 items-center justify-center rounded-md text-[#9aa0ab] transition-colors hover:bg-[#eaf2fd] hover:text-[#1565C0]"
                  >
                    <Pencil className="size-4" />
                  </button>
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

// One dialog for both Add and Edit. When `entry` is non-null the form
// prefills + saves via PATCH; when null it's a fresh insert via POST.
// `kind` is locked when editing — agent vs company is set at creation
// and can't change (see DNC PATCH route).
function DncDialog({
  token,
  entry,
  onClose,
  onSaved,
}: {
  token: string;
  entry: DncEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = entry !== null;
  const [kind, setKind] = useState<"agent" | "company">(entry?.kind ?? "agent");
  const [name, setName] = useState(entry?.name ?? "");
  const [email, setEmail] = useState(entry?.email ?? "");
  const [phone, setPhone] = useState(entry?.phone ?? "");
  const [brokerage, setBrokerage] = useState(entry?.brokerage ?? "");
  const [domain, setDomain] = useState(entry?.domain ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [pending, startTransition] = useTransition();

  async function save() {
    if (!name.trim()) {
      toast.error("Add a name");
      return;
    }
    const url = isEdit
      ? `/api/portal/${token}/dnc/${entry!.id}`
      : `/api/portal/${token}/dnc`;
    const method = isEdit ? "PATCH" : "POST";
    // PATCH route doesn't accept `kind` (locked on edit). For POST the
    // current local state of `kind` is correct.
    // Company rows are identified by domain only — clearing email/phone
    // here so the dialog can't smuggle stale state from a switched-from
    // Agent tab into the company insert payload.
    const isCompany = kind === "company";
    const payload: Record<string, unknown> = {
      name: name.trim(),
      email: isCompany ? null : (email.trim() || null),
      phone: isCompany ? null : (phone.trim() || null),
      brokerage: isCompany ? null : (brokerage.trim() || null),
      domain: isCompany ? (domain.trim() || null) : null,
      notes: notes.trim() || null,
    };
    if (!isEdit) payload.kind = kind;

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Save failed");
      return;
    }
    if (isEdit) {
      toast.success("Updated");
    } else {
      const j = await res.json().catch(() => ({}));
      if (j.pushedInstantly || j.pushedEmailBison) {
        toast.success("Added · pushed to provider blocklists");
      } else if (email.trim()) {
        toast.success("Added · provider push pending");
      } else {
        toast.success("Added");
      }
    }
    startTransition(() => onSaved());
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Edit ${entry!.kind === "agent" ? "agent" : "company"}`
              : "Add to DNC list"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {isEdit ? null : (
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
          )}
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
          {kind === "company" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Domain</label>
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. kellerwilliams.com"
                autoComplete="off"
              />
              <p className="text-[11px] text-[#9aa0ab]">
                We&apos;ll block every email at this domain across providers.
              </p>
            </div>
          ) : (
            <>
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
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Brokerage</label>
                <Input
                  value={brokerage}
                  onChange={(e) => setBrokerage(e.target.value)}
                  placeholder="optional"
                />
              </div>
            </>
          )}
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
            When you add an agent or company, we will exclude them and
            their agents from outreach.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim()}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isEdit ? (
              "Save"
            ) : (
              "Add"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CsvImportDialog({
  token,
  onClose,
  onImported,
}: {
  token: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<DncRow[] | null>(null);
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
      const mapped = parsed
        .map(csvRowToDnc)
        .filter((r): r is DncRow => Boolean(r));
      setRows(mapped);
    };
    reader.readAsText(file);
  }

  async function submit() {
    if (!rows || rows.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/${token}/dnc/csv`, {
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
      toast.success(`${j.inserted ?? rows.length} entries added to DNC`);
      onImported();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import DNC entries from CSV</DialogTitle>
        </DialogHeader>
        {!rows ? (
          <div>
            <div
              onClick={() => fileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#ebecf0] bg-[#fafbfc] px-6 py-12 text-center transition-colors hover:border-[#bcd5f1] hover:bg-[#f4f8fd]"
            >
              <FileText className="size-7 text-[#aab0ba]" />
              <div className="text-sm font-medium">
                Click to choose a CSV file
              </div>
              <div className="text-[12px] text-[#9aa0ab]">
                Columns we recognise: <code>name</code>, <code>email</code>,{" "}
                <code>phone</code>, <code>brokerage</code>, <code>domain</code>,{" "}
                <code>kind</code> (<code>agent</code> or <code>company</code>),
                <code>notes</code>
                <br />
                Headers don&apos;t need to match exactly — e.g.{" "}
                <code>Full Name</code>, <code>Email Address</code>,{" "}
                <code>Current Brokerage</code> all work. For company rows the
                <code>domain</code> is blocked at every provider; if a row
                only has an email we extract the domain from it.
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
                <span className="text-[#5b6472]">
                  {rows.length} ready to import
                </span>
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
              <div className="grid grid-cols-[80px_1.4fr_1.1fr_1fr_100px] border-b border-[#ebecf0] bg-[#fafbfc] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
                <div>Kind</div>
                <div>Name</div>
                <div>Email</div>
                <div>Brokerage / Domain</div>
                <div>Phone</div>
              </div>
              {rows.slice(0, 50).map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[80px_1.4fr_1.1fr_1fr_100px] gap-2 border-b border-[#f0f1f4] px-3 py-1.5 text-[12.5px] last:border-0"
                >
                  <div className="truncate text-[#9aa0ab] capitalize">
                    {r.kind}
                  </div>
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-[#5b6472]">{r.email ?? "—"}</div>
                  <div className="truncate text-[#5b6472]">
                    {r.kind === "company"
                      ? (r.domain ?? "—")
                      : (r.brokerage ?? "—")}
                  </div>
                  <div className="truncate text-[#5b6472]">{r.phone ?? "—"}</div>
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
                Added {importedCount} to DNC.
              </p>
            ) : (
              <p className="mt-3 text-[11.5px] leading-relaxed text-[#9aa0ab]">
                When you add an agent or company, we will exclude them
                and their agents from outreach.
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
                `Import ${rows.length} entries`
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
