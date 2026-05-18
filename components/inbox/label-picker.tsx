"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LabelChip } from "@/components/inbox/label-chip";
import type { LabelRow } from "@/lib/inbox/labels-shared";
import { cn } from "@/lib/utils";

export function LabelPickerButton({
  threadId,
  allLabels,
  assignedLabelIds,
}: {
  threadId: string;
  allLabels: LabelRow[];
  assignedLabelIds: string[];
}) {
  const router = useRouter();
  const [assigned, setAssigned] = useState<Set<string>>(new Set(assignedLabelIds));
  const [pending, startTransition] = useTransition();

  async function toggle(labelId: string) {
    const isOn = assigned.has(labelId);
    const next = new Set(assigned);
    if (isOn) next.delete(labelId);
    else next.add(labelId);
    setAssigned(next);

    const res = await fetch(`/api/threads/${threadId}/labels`, {
      method: isOn ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label_id: labelId }),
    });
    if (!res.ok) {
      // Roll back optimistic state on failure.
      setAssigned(new Set(assigned));
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Labels"
            className="size-8 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <Tag className="size-[15px]" strokeWidth={2} />
          </button>
        }
      />
      <DropdownMenuContent align="end" className="w-64 p-1 max-h-80 overflow-y-auto">
        {allLabels.length === 0 ? (
          <p className="text-xs text-muted-foreground px-2 py-3 text-center">
            No labels yet. Create one in Settings → Labels.
          </p>
        ) : (
          allLabels.map((l) => {
            const isOn = assigned.has(l.id);
            return (
              <button
                key={l.id}
                type="button"
                disabled={pending}
                onClick={() => toggle(l.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-sm hover:bg-accent transition-colors",
                  pending && "opacity-50",
                )}
              >
                <span className="size-4 flex items-center justify-center">
                  {isOn ? <Check className="size-3.5" /> : null}
                </span>
                <LabelChip name={l.name} color={l.color} />
              </button>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
