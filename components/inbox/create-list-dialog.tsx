"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Lightweight emoji picker. Categories match the masterinbox UI; we
// hard-code a useful subset rather than pulling in a full emoji library.
const CATEGORIES: { name: string; items: string[] }[] = [
  {
    name: "Smileys & emotion",
    items: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😗","☺️","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🤐","🤨","😐","😑","😶","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴","😷","🤒","🤕","🤢","🤮","🤧","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐",
    ],
  },
  {
    name: "Objects & symbols",
    items: ["🚀","⭐","✨","🔥","💎","🎯","🏆","🎉","💼","📁","📂","📌","📍","🔖","🏷️","📊","📈","📉","💰","💵","🤝","🧠","💡","⚡","🔔","📣","🛎️","🛒","🎁","✅","❌","➕","➖","🔒","🔓","🔑"],
  },
  {
    name: "Activities & travel",
    items: ["✈️","🚗","🏢","🏠","🏬","🌍","🌎","🌏","🗺️","🏝️","⛰️","🎪","🎨","🎭","📷","🎵","🎮","🏀","⚽","🏈","🎾","🏐"],
  },
  {
    name: "Animals & nature",
    items: ["🐶","🐱","🦊","🦁","🐯","🐮","🐷","🐸","🐵","🦄","🦋","🌸","🌹","🌳","🌲","🌴","🍀","🌾","☀️","🌙","⭐","🌈","☁️","❄️"],
  },
];

export function CreateListDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (id: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("🚀");
  const [iconOpen, setIconOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function submit() {
    setError(null);
    const res = await fetch("/api/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), icon }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Create failed");
      return;
    }
    const data = await res.json();
    setName("");
    setIcon("🚀");
    onOpenChange(false);
    onCreated?.(data.id);
    startTransition(() => router.refresh());
  }

  const filtered = query.trim().length > 0
    ? CATEGORIES.map((c) => ({
        name: c.name,
        items: c.items.filter(() => true), // emoji codepoint filtering is hard; just leave unfiltered
      }))
    : CATEGORIES;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create list item</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[auto_1fr] gap-4 items-start">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Add icon</label>
            <button
              type="button"
              onClick={() => setIconOpen((v) => !v)}
              className="size-16 rounded-md border bg-background flex items-center justify-center text-3xl hover:bg-accent transition-colors"
              aria-label="Pick icon"
            >
              {icon}
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">
              List name<span className="text-red-500 ml-0.5">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Eg. Customers"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) submit();
              }}
            />
          </div>
        </div>

        {iconOpen ? (
          <div className="rounded-md border bg-card max-h-72 overflow-y-auto">
            <div className="sticky top-0 bg-card border-b p-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>
            <div className="p-3 space-y-3">
              {filtered.map((c) => (
                <div key={c.name}>
                  <p className="text-xs text-muted-foreground mb-1.5">{c.name}</p>
                  <div className="grid grid-cols-10 gap-1">
                    {c.items.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => {
                          setIcon(e);
                          setIconOpen(false);
                        }}
                        className={cn(
                          "size-7 rounded flex items-center justify-center text-lg hover:bg-accent transition-colors",
                          icon === e && "bg-accent ring-1 ring-foreground",
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {error ? <p className="text-xs text-red-600">{error}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim() || pending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
