import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DIETARY_TAGS, DIETARY_TAG_IDS } from "@/lib/dietary";
import { cn } from "@/lib/utils";
import type { DietaryTagId, ListingItem } from "@/types/database";

/** Form-level draft: prices stay strings while typing, converted on submit. */
export interface ItemDraft {
  name: string;
  price: string;
  dietary_tags: DietaryTagId[];
}

interface ItemsEditorProps {
  items: ItemDraft[];
  onChange: (items: ItemDraft[]) => void;
}

export function ItemsEditor({ items, onChange }: ItemsEditorProps) {
  const reduceMotion = useReducedMotion();

  const updateItem = (index: number, patch: Partial<ItemDraft>) => {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const toggleTag = (index: number, tag: DietaryTagId) => {
    const item = items[index];
    const next = item.dietary_tags.includes(tag)
      ? item.dietary_tags.filter((entry) => entry !== tag)
      : [...item.dietary_tags, tag];
    updateItem(index, { dietary_tags: next });
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addItem = () => {
    onChange([...items, { name: "", price: "", dietary_tags: [] }]);
  };

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
        {items.map((item, index) => (
          <motion.div
            // Index keys are safe here: rows only append at the end or get removed.
            key={index}
            initial={reduceMotion ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
            className="rounded-xl border border-border/70 p-2.5"
          >
            <div className="flex items-center gap-2">
              <Input
                value={item.name}
                onChange={(e) => updateItem(index, { name: e.target.value })}
                placeholder={index === 0 ? "Glazed dozen" : "Item name"}
                aria-label={`Item ${index + 1} name`}
                className="flex-1"
              />
              <div className="relative w-28 shrink-0">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-ink-muted"
                  aria-hidden="true"
                >
                  $
                </span>
                <Input
                  value={item.price}
                  onChange={(e) => updateItem(index, { price: e.target.value })}
                  placeholder="0.00"
                  inputMode="decimal"
                  aria-label={`Item ${index + 1} price in dollars`}
                  className="pl-7 font-mono"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeItem(index)}
                aria-label={`Remove item ${index + 1}`}
                className="shrink-0 px-2.5 text-ink-muted"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div
              className="mt-2 flex flex-wrap gap-1.5"
              role="group"
              aria-label={`Item ${index + 1} dietary tags`}
            >
              {DIETARY_TAG_IDS.map((tag) => {
                const meta = DIETARY_TAGS[tag];
                const selected = item.dietary_tags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleTag(index, tag)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                      selected
                        ? cn("border-transparent", meta.className)
                        : "border-border text-ink-muted hover-fine:border-primary",
                    )}
                  >
                    <meta.Icon className="size-3" aria-hidden="true" />
                    {meta.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      <Button type="button" variant="secondary" size="sm" onClick={addItem}>
        <Plus className="size-4" aria-hidden="true" />
        Add item
      </Button>
    </div>
  );
}

export function parseItemDrafts(drafts: ItemDraft[]): ListingItem[] {
  return drafts
    .filter((draft) => draft.name.trim().length > 0)
    .map((draft) => {
      const item: ListingItem = {
        name: draft.name.trim(),
        price: Number.parseFloat(draft.price) || 0,
      };
      if (draft.dietary_tags.length > 0) item.dietary_tags = draft.dietary_tags;
      return item;
    });
}

export function toItemDrafts(items: ListingItem[] | null): ItemDraft[] {
  if (!items || items.length === 0) return [{ name: "", price: "", dietary_tags: [] }];
  return items.map((item) => ({
    name: item.name,
    price: String(item.price),
    dietary_tags: item.dietary_tags ?? [],
  }));
}
