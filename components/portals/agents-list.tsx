"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Upload,
  Search,
  Trash2,
  Loader2,
  Shield,
  FileText,
  Pencil,
  Download,
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
import type { AgentEntry } from "@/lib/portals/portal-data";
import {
  parseCsv,
  csvRowToAgent,
  toCsv,
  downloadCsv,
  type AgentRow,
} from "@/lib/portals/csv";
import { formatPhoneDisplay } from "@/lib/portals/phone";
import {
  PortalPageHeader,
  PortalEmpty,
  Avatar,
  useMounted,
} from "@/components/portals/portal-ui";
import { cn } from "@/lib/utils";

export function AgentsList({
  token,
  entries,
}: {
  token: string;
  entries: AgentEntry[];
}) {
  const router = useRouter();
  const mounted = useMounted();
  const [search, setSearch] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [openCsv, setOpenCsv] = useState(false);
  const [editing, setEditing] = useState<AgentEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.trim().toLowerCase();
    return entries.filter((e) =>
      [e.name, e.email]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q)),
    );
  }, [entries, search]);

  async function remove(id: string) {
    if (!confirm("Remove this agent from your roster?")) return;
    const res = await fetch(`/api/portal/${token}/agents/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    toast.success("Removed");
    router.refresh();
  }

  function exportRows(rows: AgentEntry[], filenameSuffix: string) {
    if (rows.length === 0) {
      toast.info("Nothing to export");
      return;
    }
    const csv = toCsv(
      rows.map((e) => ({
        name: e.name,
        email: e.email ?? "",
        phone: e.phone ?? "",
      })),
      ["name", "email", "phone"],
    );
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`agents-${filenameSuffix}-${today}.csv`, csv);
  }

  function exportCsv() {
    exportRows(filtered, "all");
  }

  // Selection helpers — kept self-contained so the same pattern can be
  // copy-pasted into other list pages. Selection survives across search
  // changes (ids stay valid), so e.g. tick three rows, change the
  // search, change it back, and they're still selected.
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
      const visibleIds = filtered.map((e) => e.id);
      const allSelected = visibleIds.every((id) => cur.has(id));
      const next = new Set(cur);
      if (allSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Remove ${selected.size} agent(s)?`)) return;
    const res = await fetch(`/api/portal/${token}/agents/bulk-delete`, {
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
    const rows = entries.filter((e) => selected.has(e.id));
    exportRows(rows, "selected");
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PortalPageHeader
        title="Your Agents"
        subtitle="Your brokerage's own agents — we never reach out to anyone on this list."
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
            <Button variant="outline" onClick={() => setOpenCsv(true)} className="gap-1.5">
              <Upload className="size-4" />
              Import CSV
            </Button>
            <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
              <Plus className="size-4" />
              Add agent
            </Button>
          </>
        }
      />

      <div className="mb-6">
        <StatCard
          icon={Shield}
          label="Your agents"
          value={entries.length}
          hint="We never reach out to these agents."
          accent
        />
      </div>

      {entries.length === 0 ? (
        <PortalEmpty
          title="No agents yet"
          hint="Upload a CSV or add agents one by one to keep your own team out of outreach."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpenCsv(true)} className="gap-1.5">
                <Upload className="size-4" />
                Import CSV
              </Button>
              <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
                <Plus className="size-4" />
                Add agent
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
                  placeholder="Search agents…"
                  className="h-9 w-64 rounded-lg border border-[#ebecf0] bg-white pl-8 pr-3 text-[13px] placeholder:text-[#9aa0ab] focus:border-[#bcd5f1] focus:outline-none focus:ring-2 focus:ring-[#eaf2fd]"
                />
              </div>
              <span className="ml-auto text-[12px] text-[#9aa0ab]">
                {filtered.length} of {entries.length}
              </span>
            </div>
          )}

          <div
            className={cn(
              "overflow-x-auto rounded-2xl border border-[#ebecf0] bg-white shadow-sm transition-opacity duration-500",
              mounted ? "opacity-100" : "opacity-0",
            )}
          >
            <div className="grid min-w-[640px] grid-cols-[36px_1.5fr_1.4fr_160px_84px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  aria-label="Select all visible"
                  checked={
                    filtered.length > 0 &&
                    filtered.every((e) => selected.has(e.id))
                  }
                  onChange={toggleAllVisible}
                  className="size-3.5 cursor-pointer accent-[#1565C0]"
                />
              </div>
              <div>Agent</div>
              <div>Email</div>
              <div>Phone</div>
              <div></div>
            </div>
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-[#9aa0ab]">
                No agents match your search.
              </div>
            ) : (
              <div className="divide-y divide-[#f0f1f4]">
                {filtered.map((a) => (
                  <div
                    key={a.id}
                    className={cn(
                      "grid min-w-[640px] grid-cols-[36px_1.5fr_1.4fr_160px_84px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fafbfc]",
                      selected.has(a.id) && "bg-[#eaf2fd]/40 hover:bg-[#eaf2fd]/60",
                    )}
                  >
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`Select ${a.name}`}
                        checked={selected.has(a.id)}
                        onChange={() => toggleOne(a.id)}
                        className="size-3.5 cursor-pointer accent-[#1565C0]"
                      />
                    </div>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={a.name} />
                      <div className="min-w-0">
                        <div className="truncate text-[13.5px] font-medium">{a.name}</div>
                      </div>
                    </div>
                    <div className="truncate text-[12.5px] text-[#5b6472]">{a.email ?? "—"}</div>
                    <div className="truncate text-[12.5px] tabular-nums text-[#5b6472]">
                      {formatPhoneDisplay(a.phone)}
                    </div>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setEditing(a)}
                        aria-label="Edit"
                        className="inline-flex size-8 items-center justify-center rounded-md text-[#9aa0ab] transition-colors hover:bg-[#eaf2fd] hover:text-[#1565C0]"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(a.id)}
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
      )}

      {openAdd ? (
        <AgentDialog
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
        <AgentDialog
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

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: typeof Shield;
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

// One dialog for both Add and Edit. When `entry` is non-null the form
// prefills + saves via PATCH; when null it's a fresh insert via POST.
function AgentDialog({
  token,
  entry,
  onClose,
  onSaved,
}: {
  token: string;
  entry: AgentEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = entry !== null;
  const [name, setName] = useState(entry?.name ?? "");
  const [email, setEmail] = useState(entry?.email ?? "");
  const [phone, setPhone] = useState(entry?.phone ?? "");
  const [pending, startTransition] = useTransition();

  async function save() {
    if (!name.trim()) {
      toast.error("Add a name");
      return;
    }
    const payload = {
      name: name.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
    };
    const url = isEdit
      ? `/api/portal/${token}/agents/${entry!.id}`
      : `/api/portal/${token}/agents`;
    const method = isEdit ? "PATCH" : "POST";
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
    toast.success(isEdit ? "Agent updated" : "Agent added");
    startTransition(() => onSaved());
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit agent" : "Add an agent"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Full name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Phone</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-[#9aa0ab]">
            Your agents you add are excluded from outreach.
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
  const [rows, setRows] = useState<AgentRow[] | null>(null);
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
      const mapped = parsed.map(csvRowToAgent).filter((r): r is AgentRow => Boolean(r));
      setRows(mapped);
    };
    reader.readAsText(file);
  }

  async function submit() {
    if (!rows || rows.length === 0) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/${token}/agents/csv`, {
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
      toast.success(`${j.inserted ?? rows.length} agents imported`);
      onImported();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import agents from CSV</DialogTitle>
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
                <code>phone</code>
                <br />
                Headers don&apos;t need to match exactly — e.g.{" "}
                <code>Full Name</code>, <code>Email Address</code>,{" "}
                <code>Phone Number</code> all work.
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
              <div className="grid grid-cols-[1.4fr_1.4fr_140px] border-b border-[#ebecf0] bg-[#fafbfc] px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
                <div>Name</div>
                <div>Email</div>
                <div>Phone</div>
              </div>
              {rows.slice(0, 50).map((r, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1.4fr_1.4fr_140px] gap-2 border-b border-[#f0f1f4] px-3 py-1.5 text-[12.5px] last:border-0"
                >
                  <div className="truncate font-medium">{r.name}</div>
                  <div className="truncate text-[#5b6472]">{r.email ?? "—"}</div>
                  <div className="truncate text-[#5b6472]">{formatPhoneDisplay(r.phone)}</div>
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
                Imported {importedCount} agents.
              </p>
            ) : (
              <p className="mt-3 text-[11.5px] leading-relaxed text-[#9aa0ab]">
                Your agents you add are excluded from outreach.
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
                `Import ${rows.length} agents`
              )}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

