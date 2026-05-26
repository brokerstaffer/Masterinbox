"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(60),
});
type Values = z.infer<typeof schema>;

export function CreateWorkspaceForm() {
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "" },
  });

  async function onSubmit(values: Values) {
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Failed to create workspace");
      return;
    }
    toast.success("Workspace created");
    router.push("/inbox");
    router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Workspace name</Label>
        <Input
          id="name"
          autoFocus
          placeholder="BrokerStaffer"
          {...form.register("name")}
        />
        {form.formState.errors.name ? (
          <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
        ) : null}
      </div>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? <Loader2 className="size-4 animate-spin" /> : "Create workspace"}
      </Button>
    </form>
  );
}
