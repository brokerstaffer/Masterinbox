"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Pencil, Mail } from "lucide-react";
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
  PortalPageHeader,
  PortalEmpty,
  Avatar,
  useMounted,
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

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <PortalPageHeader
        title="Team"
        subtitle="Who receives intro notifications and how."
        actions={
          <Button onClick={() => setShowAddForm((v) => !v)} className="gap-1.5">
            <Plus className="size-4" />
            Add member
          </Button>
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
            <Button onClick={() => setShowAddForm(true)} className="gap-1.5">
              <Plus className="size-4" />
              Add the first member
            </Button>
          }
        />
      ) : (
        <div
          className={cn(
            "overflow-hidden rounded-2xl border border-[#ebecf0] bg-white shadow-sm transition-opacity duration-500",
            mounted ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="grid grid-cols-[1.4fr_1.1fr_1.6fr_72px_84px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
            <div>Member</div>
            <div>Title</div>
            <div>Email / Phone</div>
            <div className="text-center">Active</div>
            <div></div>
          </div>
          <div className="divide-y divide-[#f0f1f4]">
            {members.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "grid grid-cols-[1.4fr_1.1fr_1.6fr_72px_84px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fafbfc]",
                  !m.active && "opacity-60",
                )}
              >
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
        </div>
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
