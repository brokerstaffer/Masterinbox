"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  FileText,
  ChevronDown,
  ChevronRight,
  Folder,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TemplateRow {
  id: string;
  name: string;
  body: string;
  category: string | null;
}

const UNCATEGORISED = "Uncategorised";

// Bucket templates by category — named categories alphabetically,
// "Uncategorised" always last.
function groupByCategory(
  rows: TemplateRow[],
): Array<{ category: string; templates: TemplateRow[] }> {
  const map = new Map<string, TemplateRow[]>();
  for (const t of rows) {
    const cat = (t.category ?? "").trim() || UNCATEGORISED;
    const list = map.get(cat) ?? [];
    list.push(t);
    map.set(cat, list);
  }
  return [...map.entries()]
    .map(([category, templates]) => ({ category, templates }))
    .sort((a, b) => {
      if (a.category === UNCATEGORISED) return 1;
      if (b.category === UNCATEGORISED) return -1;
      return a.category.localeCompare(b.category);
    });
}

export function TemplatesManager({ initial }: { initial: TemplateRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<TemplateRow | "new" | null>(null);
  const [deleting, setDeleting] = useState<TemplateRow | null>(null);

  const groups = useMemo(() => groupByCategory(initial), [initial]);
  // Distinct existing category names — fed to the dialog's datalist.
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          initial
            .map((t) => (t.category ?? "").trim())
            .filter((c) => c.length > 0),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [initial],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-muted-foreground">
          {initial.length} template{initial.length === 1 ? "" : "s"}
          {categories.length > 0
            ? ` · ${categories.length} categor${categories.length === 1 ? "y" : "ies"}`
            : ""}
        </span>
        <Button size="sm" onClick={() => setEditing("new")} className="gap-1.5">
          <Plus className="size-4" />
          New template
        </Button>
      </div>

      {initial.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-card p-12 text-center">
          <FileText className="size-8 mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No templates yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Create your first reusable reply snippet — group them into categories
            to stay organised.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <CategorySection
              key={g.category}
              category={g.category}
              templates={g.templates}
              onEdit={setEditing}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      {editing ? (
        <EditDialog
          template={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteDialog
          template={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function CategorySection({
  category,
  templates,
  onEdit,
  onDelete,
}: {
  category: string;
  templates: TemplateRow[];
  onEdit: (t: TemplateRow) => void;
  onDelete: (t: TemplateRow) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-accent/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="size-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground shrink-0" />
        )}
        <Folder className="size-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-semibold">{category}</span>
        <span className="text-xs text-muted-foreground">{templates.length}</span>
      </button>
      {open ? (
        <div className="divide-y border-t">
          {templates.map((t) => (
            <div key={t.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 whitespace-pre-wrap">
                  {t.body || "(empty)"}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onEdit(t)}
                  aria-label="Edit"
                  className="size-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(t)}
                  aria-label="Delete"
                  className="size-8 rounded-md inline-flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-red-600 transition-colors"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EditDialog({
  template,
  categories,
  onClose,
  onSaved,
}: {
  template: TemplateRow | null;
  categories: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [category, setCategory] = useState(template?.category ?? "");
  const [pending, startTransition] = useTransition();

  async function save() {
    if (!name.trim()) {
      toast.error("Give the template a name");
      return;
    }
    const isEdit = template !== null;
    const res = await fetch(
      isEdit ? `/api/reply-templates/${template.id}` : "/api/reply-templates",
      {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          body,
          category: category.trim() || null,
        }),
      },
    );
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? "Save failed");
      return;
    }
    toast.success(isEdit ? "Template updated" : "Template created");
    startTransition(() => onSaved());
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Schedule a call"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Category</label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Choose or type a category…"
                list="template-category-options"
              />
              <datalist id="template-category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Body</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="The reply text to insert…"
              rows={8}
              className="resize-y"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || !name.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  template,
  onClose,
  onDeleted,
}: {
  template: TemplateRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [pending, startTransition] = useTransition();
  async function confirmDelete() {
    const res = await fetch(`/api/reply-templates/${template.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Delete failed");
      return;
    }
    startTransition(() => onDeleted());
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete &quot;{template.name}&quot;?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          This template will be removed for everyone in the workspace.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={confirmDelete}
            disabled={pending}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
