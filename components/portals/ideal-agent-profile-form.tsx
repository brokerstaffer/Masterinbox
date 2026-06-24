"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// "Define Your Ideal Agent Profile" — the recruiting-target spec.
// Persists to clients.ideal_agent_profile (JSONB) via PATCH
// /api/portal/[token]/ideal-agent-profile. Feature-gated upstream;
// when this component renders, the flag is already on.

type IdealAgentProfile = {
  annual_sales_volume?: string | null;
  closed_transactions?: string | null;
  years_experience?: string | null;
  mls_affiliations?: string[];
  target_markets?: string[];
  additional_criteria?: string | null;
};

// Range options picked to cover the realistic spread of an
// agent's annual production without forcing the brokerage to
// commit to a specific number.
const SALES_VOLUME_OPTIONS = [
  "Under $1M",
  "$1M – $3M",
  "$3M – $5M",
  "$5M – $10M",
  "$10M – $25M",
  "$25M+",
];

const TRANSACTIONS_OPTIONS = [
  "Under 5",
  "5 – 10",
  "11 – 25",
  "26 – 50",
  "51+",
];

const EXPERIENCE_OPTIONS = [
  "Under 1 year",
  "1 – 3 years",
  "3 – 5 years",
  "5 – 10 years",
  "10+ years",
];

export function IdealAgentProfileForm({
  token,
  initial,
}: {
  token: string;
  initial: IdealAgentProfile;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [salesVolume, setSalesVolume] = useState<string>(
    initial.annual_sales_volume ?? "",
  );
  const [transactions, setTransactions] = useState<string>(
    initial.closed_transactions ?? "",
  );
  const [experience, setExperience] = useState<string>(
    initial.years_experience ?? "",
  );
  const [mls, setMls] = useState<string[]>(initial.mls_affiliations ?? []);
  const [markets, setMarkets] = useState<string[]>(initial.target_markets ?? []);
  const [additional, setAdditional] = useState<string>(
    initial.additional_criteria ?? "",
  );

  const [mlsDraft, setMlsDraft] = useState("");
  const [marketDraft, setMarketDraft] = useState("");

  function addMls() {
    const v = mlsDraft.trim();
    if (!v) return;
    if (mls.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setMls([...mls, v]);
    setMlsDraft("");
  }
  function addMarket() {
    const v = marketDraft.trim();
    if (!v) return;
    if (markets.some((x) => x.toLowerCase() === v.toLowerCase())) return;
    setMarkets([...markets, v]);
    setMarketDraft("");
  }

  function discard() {
    setSalesVolume(initial.annual_sales_volume ?? "");
    setTransactions(initial.closed_transactions ?? "");
    setExperience(initial.years_experience ?? "");
    setMls(initial.mls_affiliations ?? []);
    setMarkets(initial.target_markets ?? []);
    setAdditional(initial.additional_criteria ?? "");
    setMlsDraft("");
    setMarketDraft("");
  }

  async function save() {
    setSaving(true);
    const body: IdealAgentProfile = {
      annual_sales_volume: salesVolume || null,
      closed_transactions: transactions || null,
      years_experience: experience || null,
      mls_affiliations: mls,
      target_markets: markets,
      additional_criteria: additional.trim() || null,
    };
    const res = await fetch(
      `/api/portal/${token}/ideal-agent-profile`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error ?? "Could not save");
      return;
    }
    toast.success("Ideal Agent Profile saved");
    startTransition(() => router.refresh());
  }

  const busy = saving || pending;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Define Your Ideal Agent Profile
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tell BrokerStaffer who to target when sourcing agents for you.
          The more specific you are, the better the match.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <RangeField
          label="Annual sales volume"
          value={salesVolume}
          onChange={setSalesVolume}
          options={SALES_VOLUME_OPTIONS}
          placeholder="Select a range…"
        />
        <ChipField
          label="Target markets"
          chips={markets}
          onRemove={(v) =>
            setMarkets(markets.filter((x) => x !== v))
          }
          draft={marketDraft}
          onDraftChange={setMarketDraft}
          onAdd={addMarket}
          placeholder="e.g., Philadelphia"
        />

        <RangeField
          label="Closed transactions per year"
          value={transactions}
          onChange={setTransactions}
          options={TRANSACTIONS_OPTIONS}
          placeholder="Select a range…"
        />
        <ChipField
          label="MLS affiliations"
          chips={mls}
          onRemove={(v) => setMls(mls.filter((x) => x !== v))}
          draft={mlsDraft}
          onDraftChange={setMlsDraft}
          onAdd={addMls}
          placeholder="e.g., BRIGHT MLS"
        />

        <RangeField
          label="Years of experience"
          value={experience}
          onChange={setExperience}
          options={EXPERIENCE_OPTIONS}
          placeholder="Select a range…"
        />
        <div>
          <Label className="text-sm font-medium">
            Additional criteria
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Textarea
            value={additional}
            onChange={(e) => setAdditional(e.target.value)}
            placeholder="Any additional criteria or specific requirements for your ideal agent…"
            rows={4}
            maxLength={2000}
            className="mt-1.5 resize-none"
          />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-end gap-2 border-t pt-6">
        <Button
          type="button"
          variant="outline"
          onClick={discard}
          disabled={busy}
        >
          Discard
        </Button>
        <Button type="button" onClick={save} disabled={busy}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function RangeField({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "mt-1.5 h-9 w-full rounded-md border bg-background px-3 text-sm",
          "focus:outline-none focus:ring-2 focus:ring-ring/30",
          !value && "text-muted-foreground",
        )}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o} className="text-foreground">
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function ChipField({
  label,
  chips,
  onRemove,
  draft,
  onDraftChange,
  onAdd,
  placeholder,
}: {
  label: string;
  chips: string[];
  onRemove: (v: string) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
}) {
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      <div className="mt-1.5 flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder={placeholder}
          className="h-9"
        />
        <Button
          type="button"
          variant="outline"
          onClick={onAdd}
          disabled={!draft.trim()}
          className="h-9 shrink-0"
        >
          <Plus className="size-3.5" />
          Add
        </Button>
      </div>
      {chips.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-0.5 text-xs"
            >
              {c}
              <button
                type="button"
                onClick={() => onRemove(c)}
                aria-label={`Remove ${c}`}
                className="rounded-full p-0.5 hover:bg-accent-foreground/10"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
