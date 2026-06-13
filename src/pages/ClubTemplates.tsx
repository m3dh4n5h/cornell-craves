import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, LayoutTemplate, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  ItemsEditor,
  parseItemDrafts,
  toItemDrafts,
  type ItemDraft,
} from "@/components/ItemsEditor";
import { TemplateCard } from "@/components/TemplateCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { BRANDS } from "@/lib/brands";
import { cn } from "@/lib/utils";
import type { CampusLocation, RecurringTemplate } from "@/types/database";

const FREQUENCIES = [
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "monthly", label: "Monthly" },
] as const;

function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function advanceDate(from: string | null, frequency: RecurringTemplate["frequency"]): string {
  const base = from ? new Date(`${from}T00:00:00`) : new Date();
  if (frequency === "weekly") base.setDate(base.getDate() + 7);
  else if (frequency === "biweekly") base.setDate(base.getDate() + 14);
  else base.setMonth(base.getMonth() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

interface TemplateFormProps {
  clubId: string;
  initial: RecurringTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
}

function TemplateForm({ clubId, initial, onSaved, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [items, setItems] = useState<ItemDraft[]>(toItemDrafts(initial?.items ?? null));
  const [frequency, setFrequency] = useState<RecurringTemplate["frequency"]>(initial?.frequency ?? "weekly");
  const [nextRunDate, setNextRunDate] = useState(initial?.next_run_date ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const errors = {
    name: name.trim() ? undefined : "Name the template (it becomes the listing title).",
    brand: brand.trim() ? undefined : "Pick the brand.",
    items: parseItemDrafts(items).length > 0 ? undefined : "Add at least one item with a name.",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (hasErrors) return;
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      brand: brand.trim(),
      description: description.trim() || null,
      items: parseItemDrafts(items),
      frequency,
      next_run_date: nextRunDate || null,
    };
    const { error } = initial
      ? await supabase.from("recurring_templates").update(payload).eq("id", initial.id)
      : await supabase.from("recurring_templates").insert({ ...payload, club_id: clubId });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(initial ? "Template updated" : "Template saved");
    onSaved();
  };

  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-bold">{initial ? "Edit template" : "New template"}</h2>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="template-name">Template name</Label>
          <Input
            id="template-name"
            value={name}
            invalid={showErrors && Boolean(errors.name)}
            onChange={(e) => setName(e.target.value)}
            placeholder="Friday dozen drop"
          />
          {showErrors && errors.name && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {errors.name}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="template-brand">Brand</Label>
          <Input
            id="template-brand"
            list="template-brand-options"
            value={brand}
            invalid={showErrors && Boolean(errors.brand)}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Krispy Kreme"
          />
          <datalist id="template-brand-options">
            {BRANDS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          {showErrors && errors.brand && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {errors.brand}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <Label htmlFor="template-description">Description (optional)</Label>
        <Textarea
          id="template-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Carried over to every listing posted from this template."
        />
      </div>

      <div className="mt-5">
        <Label>Items and prices</Label>
        <ItemsEditor items={items} onChange={setItems} />
        {showErrors && errors.items && (
          <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
            {errors.items}
          </p>
        )}
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label>Frequency</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Frequency">
            {FREQUENCIES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={frequency === id}
                onClick={() => setFrequency(id)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                  frequency === id
                    ? "border-ink bg-ink text-surface-raised"
                    : "border-border text-ink-muted hover-fine:border-primary",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="template-next-run">Next run date (optional)</Label>
          <Input
            id="template-next-run"
            type="date"
            value={nextRunDate}
            onChange={(e) => setNextRunDate(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {initial ? "Save changes" : "Save template"}
        </Button>
      </div>
    </form>
  );
}

interface PostPanelProps {
  template: RecurringTemplate;
  locations: CampusLocation[];
  onPosted: () => void;
  onCancel: () => void;
}

function PostPanel({ template, locations, onPosted, onCancel }: PostPanelProps) {
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocal(new Date(Date.now() + 6 * 3_600_000)));
  const [locationId, setLocationId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
      toast.error("Pick an end time in the future.");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("listings").insert({
      club_id: template.club_id,
      brand: template.brand,
      title: template.name,
      description: template.description,
      items: template.items,
      pickup_location_id: locationId || null,
      expires_at: new Date(expiresAt).toISOString(),
    });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    await supabase
      .from("recurring_templates")
      .update({ next_run_date: advanceDate(template.next_run_date, template.frequency) })
      .eq("id", template.id);
    setSubmitting(false);
    toast.success(`"${template.name}" is live on the feed`);
    onPosted();
  };

  return (
    <form onSubmit={post} className="rounded-2xl border border-primary-dark/40 bg-primary/10 p-4">
      <h3 className="text-base font-bold">Post "{template.name}" now</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="post-expires">Ends at</Label>
          <Input
            id="post-expires"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="post-location">Pickup location (optional)</Label>
          <select
            id="post-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-base text-ink focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40"
          >
            <option value="">No map pin</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={submitting}>
          Publish drop
        </Button>
      </div>
    </form>
  );
}

export default function ClubTemplates() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user, loading: authLoading } = useAuth();
  const reduceMotion = useReducedMotion();
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [locations, setLocations] = useState<CampusLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<"closed" | "create" | string>("closed");
  const [postingId, setPostingId] = useState<string | null>(null);

  const userId = user?.id ?? null;

  const refetch = useCallback(async () => {
    if (!userId) return;
    const [templatesResult, locationsResult] = await Promise.all([
      supabase
        .from("recurring_templates")
        .select("*")
        .eq("club_id", userId)
        .order("created_at", { ascending: false })
        .returns<RecurringTemplate[]>(),
      supabase.from("campus_locations").select("*").order("name"),
    ]);
    if (templatesResult.error) {
      toast.error(templatesResult.error.message);
    } else {
      setTemplates(templatesResult.data ?? []);
    }
    setLocations(locationsResult.data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId && clubId === userId) void refetch();
  }, [userId, clubId, refetch]);

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10" aria-busy="true" aria-label="Loading templates">
        <div className="h-9 w-48 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (clubId !== user.id) return <Navigate to={`/club/${user.id}/templates`} replace />;

  const editingTemplate =
    formMode !== "closed" && formMode !== "create"
      ? (templates.find((template) => template.id === formMode) ?? null)
      : null;

  const toggleActive = async (template: RecurringTemplate) => {
    const { error } = await supabase
      .from("recurring_templates")
      .update({ is_active: !template.is_active })
      .eq("id", template.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(template.is_active ? "Template paused" : "Template resumed");
      await refetch();
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover-fine:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Recurring templates</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Save a fundraiser once, post it in two clicks every week.
          </p>
        </div>
        {formMode === "closed" && (
          <Button onClick={() => setFormMode("create")}>
            <Plus className="size-4" aria-hidden="true" />
            New template
          </Button>
        )}
      </div>

      <AnimatePresence mode="wait">
        {formMode !== "closed" && (
          <motion.div
            key={formMode}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mt-6"
          >
            <TemplateForm
              clubId={user.id}
              initial={editingTemplate}
              onSaved={() => {
                setFormMode("closed");
                void refetch();
              }}
              onCancel={() => setFormMode("closed")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      ) : templates.length === 0 && formMode === "closed" ? (
        <div className="mt-8">
          <EmptyState
            icon={<LayoutTemplate className="size-6" aria-hidden="true" />}
            title="No templates yet"
            body="If you run the same fundraiser every week, save it as a template and skip the form next time."
            actionLabel="Create your first template"
            onAction={() => setFormMode("create")}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <AnimatePresence>
            {postingId && (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                <PostPanel
                  template={templates.find((template) => template.id === postingId)!}
                  locations={locations}
                  onPosted={() => {
                    setPostingId(null);
                    void refetch();
                  }}
                  onCancel={() => setPostingId(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                busy={false}
                onPost={() => setPostingId(template.id)}
                onEdit={() => setFormMode(template.id)}
                onToggleActive={() => void toggleActive(template)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
