"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Shield } from "lucide-react";
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
import {
  PortalPageHeader,
  PortalEmpty,
  Pill,
  Avatar,
  useMounted,
} from "@/components/portals/portal-ui";

function TeamStatusPill({ member }: { member: TeamMember }) {
  if (!member.email) return <Pill tone="neutral">No email</Pill>;
  if (member.push_error) return <Pill tone="warning">Push failed</Pill>;
  if (member.pushed_to_instantly || member.pushed_to_emailbison) {
    return <Pill tone="success">Protected</Pill>;
  }
  return <Pill tone="neutral">Pending</Pill>;
}

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
  const [openAdd, setOpenAdd] = useState(false);

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
        subtitle="Your brokerage's internal roster — auto-excluded from outreach."
        actions={
          <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
            <Plus className="size-4" />
            Add member
          </Button>
        }
      />

      <div className="mb-6 rounded-2xl border border-[#d4e4f8] bg-[#eaf2fd]/60 p-4">
        <div className="flex gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#1565C0] text-white">
            <Shield className="size-4" />
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#0f1320]">
              Team emails are auto-protected from outreach
            </div>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-[#5b6472]">
              When you add a team member their email is immediately pushed to
              the Instantly and EmailBison blocklists — the same protection
              Your Agents gets, so no one on your team accidentally ends up
              in a cold-outreach campaign.
            </p>
          </div>
        </div>
      </div>

      {members.length === 0 ? (
        <PortalEmpty
          title="No team members yet"
          hint="Add the people who should hear about every introduction."
          action={
            <Button onClick={() => setOpenAdd(true)} className="gap-1.5">
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
          <div className="grid grid-cols-[1.4fr_1.1fr_1.4fr_110px_72px_44px] items-center gap-3 border-b border-[#ebecf0] bg-[#fafbfc] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#9aa0ab]">
            <div>Member</div>
            <div>Title</div>
            <div>Email</div>
            <div>Status</div>
            <div className="text-center">Active</div>
            <div></div>
          </div>
          <div className="divide-y divide-[#f0f1f4]">
            {members.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "grid grid-cols-[1.4fr_1.1fr_1.4fr_110px_72px_44px] items-center gap-3 px-4 py-3 transition-colors hover:bg-[#fafbfc]",
                  !m.active && "opacity-60",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={m.name} />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-medium">{m.name}</div>
                    <div className="text-[11px] text-[#9aa0ab]">
                      Added {fmtDate(m.created_at)}
                    </div>
                  </div>
                </div>
                <div className="truncate text-[13px] text-[#5b6472]">
                  {m.title ?? "—"}
                </div>
                <div className="truncate text-[12.5px] text-[#5b6472]">{m.email}</div>
                <div>
                  <TeamStatusPill member={m} />
                </div>
                <div className="flex justify-center">
                  <Switch
                    checked={m.active}
                    onCheckedChange={(v) => setActive(m.id, Boolean(v))}
                    aria-label="Active"
                  />
                </div>
                <div className="flex justify-end">
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

      {openAdd ? (
        <AddMemberDialog
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

function AddMemberDialog({
  token,
  onClose,
  onAdded,
}: {
  token: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a team member</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Full name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Email</label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@brokerage.com"
            />
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim() || !email.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
