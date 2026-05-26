"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Play, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { LabelChip } from "@/components/inbox/label-chip";
import type { LabelRow } from "@/lib/inbox/labels-shared";

interface BackfillReport {
  scanned: number;
  labeled: number;
  no_inbound: number;
  skipped_already_labeled: number;
  skipped_disabled: number;
  skipped_no_key: number;
  skipped_no_config: number;
  skipped_no_labels: number;
  skipped_model_returned_none: number;
  skipped_no_match: number;
  errors: number;
  sample_labels: Array<{ thread_id: string; label: string }>;
  sample_errors: Array<{ thread_id: string; error: string }>;
}

interface ServerConfig {
  enabled: boolean;
  provider: "openai" | "anthropic" | "openrouter" | "vllm";
  has_api_key: boolean;
  model: string;
  label_old_replies: boolean;
  relabel_ongoing: boolean;
  use_custom_prompt: boolean;
  custom_prompt: string | null;
  category_set: string[];
  last_run_at: string | null;
}

const PROVIDERS = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "vllm", label: "vLLM (self-hosted)" },
] as const;

const MODEL_OPTIONS: Record<string, string[]> = {
  openai: [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4.1-mini",
    "gpt-4.1",
    "gpt-5-mini",
    "gpt-5",
  ],
  anthropic: [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-6",
    "claude-opus-4-7",
  ],
  openrouter: [
    "openai/gpt-4o-mini",
    "openai/gpt-4o",
    "anthropic/claude-haiku-4-5",
    "anthropic/claude-sonnet-4-6",
    "google/gemini-2.0-flash",
    "meta-llama/llama-3.1-70b-instruct",
  ],
  vllm: ["meta-llama/Llama-3.1-8B-Instruct"],
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5-20251001",
  openrouter: "openai/gpt-4o-mini",
  vllm: "meta-llama/Llama-3.1-8B-Instruct",
};

export function AiLabelingForm({
  initial,
  labels,
}: {
  initial: ServerConfig | null;
  labels: LabelRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [enabled, setEnabled] = useState(initial?.enabled ?? false);
  const [provider, setProvider] = useState<ServerConfig["provider"]>(initial?.provider ?? "openai");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(initial?.model ?? DEFAULT_MODELS.openai);
  const [labelOld, setLabelOld] = useState(initial?.label_old_replies ?? false);
  const [relabel, setRelabel] = useState(initial?.relabel_ongoing ?? false);
  const [useCustomPrompt, setUseCustomPrompt] = useState(initial?.use_custom_prompt ?? false);
  const [customPrompt, setCustomPrompt] = useState(initial?.custom_prompt ?? "");
  const [categorySet, setCategorySet] = useState<string[]>(initial?.category_set ?? []);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runReport, setRunReport] = useState<BackfillReport | null>(null);

  function toggleCategory(name: string) {
    setCategorySet((cur) =>
      cur.includes(name) ? cur.filter((c) => c !== name) : [...cur, name],
    );
  }

  async function save() {
    setError(null);
    setMessage(null);
    const body: Record<string, unknown> = {
      enabled,
      provider,
      model,
      label_old_replies: labelOld,
      relabel_ongoing: relabel,
      use_custom_prompt: useCustomPrompt,
      custom_prompt: useCustomPrompt ? customPrompt : null,
      category_set: categorySet,
    };
    if (apiKey.trim().length > 0) body.api_key = apiKey.trim();

    const res = await fetch("/api/ai-labeling", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error ?? "Save failed");
      return;
    }
    setApiKey("");
    setMessage("Saved.");
    startTransition(() => router.refresh());
  }

  async function clearKey() {
    if (!confirm("Clear the saved API key?")) return;
    setError(null);
    setMessage(null);
    const res = await fetch("/api/ai-labeling", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: "" }),
    });
    if (!res.ok) {
      setError("Clear failed");
      return;
    }
    setMessage("API key cleared.");
    startTransition(() => router.refresh());
  }

  async function runBackfill() {
    if (!confirm("Run AI labeling on every open thread? Uses your API credits.")) return;
    setError(null);
    setMessage(null);
    setRunReport(null);
    setRunning(true);
    try {
      const res = await fetch("/api/ai-labeling/run", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Run failed");
      } else {
        setRunReport(json as BackfillReport);
        startTransition(() => router.refresh());
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Enable AI labeling</p>
            <p className="text-xs text-muted-foreground">
              When a new inbound reply arrives, automatically apply one of your labels.
            </p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Provider</label>
            <select
              value={provider}
              onChange={(e) => {
                const next = e.target.value as ServerConfig["provider"];
                setProvider(next);
                // Bump model to a sensible default for the new provider.
                setModel(DEFAULT_MODELS[next] ?? "");
              }}
              className="w-full h-9 rounded-md border bg-background px-3 text-sm"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Model</label>
            <ModelPicker
              provider={provider}
              value={model}
              onChange={setModel}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium">API Key</label>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  initial?.has_api_key ? "•••••••• (saved — leave blank to keep)" : "sk-…"
                }
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 size-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label="Show key"
              >
                {showKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
            {initial?.has_api_key ? (
              <Button variant="outline" size="sm" onClick={clearKey} disabled={pending}>
                Clear
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Stored encrypted with pgcrypto. Never sent to the browser after save.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <p className="text-sm font-medium">Behavior</p>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">Re-label ongoing replies</p>
            <p className="text-xs text-muted-foreground">
              If a new inbound arrives on a thread that's already AI-labeled, replace the label
              with the latest classification.
            </p>
          </div>
          <Switch checked={relabel} onCheckedChange={setRelabel} />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm">Include in historical backfill</p>
            <p className="text-xs text-muted-foreground">
              When you click "Run on historical replies", include threads created before AI was
              enabled.
            </p>
          </div>
          <Switch checked={labelOld} onCheckedChange={setLabelOld} />
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Candidate labels</p>
            <p className="text-xs text-muted-foreground">
              The model will only pick one of the labels you turn ON below.
              Click any chip to toggle it.
            </p>
          </div>
          <span className="text-xs text-muted-foreground">
            {categorySet.length} / {labels.length} on
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {labels.map((l) => {
            const selected = categorySet.includes(l.name);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleCategory(l.name)}
                title={
                  selected
                    ? `On — AI may apply "${l.name}"`
                    : `Off — AI will never apply "${l.name}"`
                }
                className={selected ? "" : "opacity-40 hover:opacity-100 transition-opacity"}
              >
                <LabelChip name={l.name} color={l.color} />
              </button>
            );
          })}
        </div>
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-[12px] text-muted-foreground space-y-1.5">
          <p>
            <span className="font-medium text-foreground">Turned off:</span>{" "}
            A label that is greyed out above will never be applied by the AI
            to a new reply. Existing assignments stay on the conversations
            they&apos;re already on.
          </p>
          <p>
            <span className="font-medium text-foreground">No match:</span>{" "}
            When the AI can&apos;t confidently pick any of the turned-on
            labels, the conversation stays untagged and surfaces in the{" "}
            <span className="font-medium">Open Responses</span> view so a
            reply manager can categorise it manually.
          </p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Custom system prompt</p>
            <p className="text-xs text-muted-foreground">
              Override the default classification prompt. Use this to tune classification for your
              specific industry or rules.
            </p>
          </div>
          <Switch checked={useCustomPrompt} onCheckedChange={setUseCustomPrompt} />
        </div>
        {useCustomPrompt ? (
          <Textarea
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
            rows={8}
            placeholder="You are a sales-inbox triage classifier..."
          />
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      {runReport ? <RunReportCard report={runReport} /> : null}

      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={runBackfill}
          disabled={running || pending || !initial?.has_api_key}
          className="gap-2"
        >
          <Play className="size-3.5" />
          {running ? "Running…" : "Run on historical replies"}
        </Button>
        <div className="flex items-center gap-3">
          {initial?.last_run_at ? (
            <span className="text-xs text-muted-foreground">
              Last run {new Date(initial.last_run_at).toLocaleString()}
            </span>
          ) : null}
          <Button onClick={save} disabled={pending} className="gap-2">
            <Sparkles className="size-3.5" />
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function RunReportCard({ report }: { report: BackfillReport }) {
  const skipRows: Array<{ label: string; value: number; hint?: string }> = [
    {
      label: "Already labeled (and re-label is off)",
      value: report.skipped_already_labeled,
      hint: "Turn on 'Re-label ongoing replies' to overwrite these.",
    },
    {
      label: "No inbound message on thread",
      value: report.no_inbound,
      hint: "Thread had only outbound messages — nothing to classify.",
    },
    {
      label: "Model returned NONE",
      value: report.skipped_model_returned_none,
      hint: "Prompt was too strict for the reply or the reply was empty/system noise.",
    },
    {
      label: "Model returned a name not in your labels",
      value: report.skipped_no_match,
      hint: "Tighten the candidate list or refine the prompt to use exact names.",
    },
    {
      label: "AI labeling disabled",
      value: report.skipped_disabled,
      hint: "Run-on-webhook is off. Backfill ran in force mode anyway, so this should be 0.",
    },
    { label: "No API key configured", value: report.skipped_no_key },
    { label: "No AI config row", value: report.skipped_no_config },
    { label: "No labels in workspace", value: report.skipped_no_labels },
    { label: "Errors", value: report.errors },
  ].filter((r) => r.value > 0);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Run report</p>
        <p className="text-xs text-muted-foreground">
          {report.labeled} labeled · {report.scanned} scanned
        </p>
      </div>

      {report.sample_labels.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Sample classifications
          </p>
          <ul className="text-xs space-y-0.5">
            {report.sample_labels.map((s) => (
              <li key={s.thread_id} className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono text-[10px] truncate w-32">{s.thread_id}</span>
                <span className="text-foreground">→ {s.label}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {skipRows.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">
            Why some weren't labeled
          </p>
          <ul className="text-xs space-y-1.5">
            {skipRows.map((r) => (
              <li key={r.label} className="flex items-start gap-2">
                <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded shrink-0">
                  {r.value}
                </span>
                <div>
                  <p>{r.label}</p>
                  {r.hint ? <p className="text-muted-foreground">{r.hint}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.sample_errors.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5">Sample errors</p>
          <ul className="text-xs space-y-0.5">
            {report.sample_errors.map((s, i) => (
              <li key={i} className="text-red-600">
                <span className="font-mono text-[10px] mr-2">{s.thread_id.slice(0, 8)}</span>
                {s.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// Two-mode model picker: a dropdown of presets per provider, plus a
// "Custom…" option that reveals a free-text input for newer/unlisted models.
function ModelPicker({
  provider,
  value,
  onChange,
}: {
  provider: "openai" | "anthropic" | "openrouter" | "vllm";
  value: string;
  onChange: (v: string) => void;
}) {
  const presets = MODEL_OPTIONS[provider] ?? [];
  const isCustom = !presets.includes(value);
  const [mode, setMode] = useState<"preset" | "custom">(isCustom ? "custom" : "preset");

  if (mode === "custom") {
    return (
      <div className="flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="model-id"
          autoFocus
        />
        <button
          type="button"
          onClick={() => {
            setMode("preset");
            onChange(presets[0] ?? "");
          }}
          className="text-xs text-muted-foreground hover:text-foreground whitespace-nowrap"
        >
          Use preset
        </button>
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__custom__") {
          setMode("custom");
          onChange("");
        } else {
          onChange(v);
        }
      }}
      className="w-full h-9 rounded-md border bg-background px-3 text-sm"
    >
      {presets.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value="__custom__">Custom…</option>
    </select>
  );
}
