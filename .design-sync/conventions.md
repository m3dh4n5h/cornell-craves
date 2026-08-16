# Building with Cornell Craves

Warm, food-forward campus UI: a saffron accent on near-white surfaces, geometric display type over a humanist body face, generously rounded cards.

## Setup

**No provider or theme wrapper is required.** Every component here renders correctly on its own, as long as `styles.css` is loaded (it pulls in the fonts and all component CSS). There is no `ThemeProvider`, and no context to wire up.

Two exceptions worth knowing:

- **Toasts.** Mount `<Toaster />` once near the root of the design, then call `toast(...)` from anywhere. Import `toast` from this package, never from `sonner` directly: a separate `sonner` import creates its own store that this `Toaster` does not listen to, and the toast silently never appears.
- **Controlled inputs.** `Combobox`, `SplitTypeSelector`, `SplitOrderToggle`, and `RatingStars` (when given `onChange`) are controlled. They need `useState`, not a bare `value`.

## Styling idiom

Tailwind v4 utility classes generated from a custom `@theme`. Use the design's own vocabulary rather than raw hex or generic Tailwind palette names (there is no `blue-500` here).

| Family | Verified class names |
|---|---|
| Surfaces | `bg-surface` (page), `bg-surface-raised` (cards, inputs), `bg-primary`, `bg-primary-dark`, `bg-accent`, `bg-ink` |
| Text | `text-ink` (body), `text-ink-muted` (secondary), `text-accent` (errors), `text-primary-dark`, `text-on-primary`, `text-on-accent` |
| Borders | `border-border` (default hairline), `border-primary-dark`, `border-accent`, `border-ink` |
| Type scale | `text-xs` `text-sm` `text-base` `text-lg` `text-xl` `text-2xl` `text-3xl` (all fluid) |
| Weight | `font-medium` `font-semibold` `font-bold` `font-extrabold` |
| Fonts | `font-display` (Cabinet Grotesk, headings), `font-mono` (prices, IDs, handles) |
| Dietary tints | `bg-tag-green` `bg-tag-amber` `bg-tag-rust` `bg-tag-blue` `bg-tag-violet` `bg-tag-wheat` |
| Radius | `rounded-xl` (inputs, small), `rounded-2xl` (cards), `rounded-full` (pills) |
| Layering | `z-raised` `z-nav` `z-overlay` `z-modal` |

**Body text needs no font class.** The body face (Epilogue) is applied globally; there is no `font-body` utility. Use `font-display` only to opt *into* the display face.

**One important constraint:** this stylesheet is compiled from the app's own source, so it contains the utilities the app actually uses, not all of Tailwind. Common layout utilities (`flex`, `grid`, `gap-*`, `p-*`, `mt-*`, `w-full`, `max-w-*`, `truncate`, `min-w-0`, `shrink-0`, `divide-y`, `space-y-*`) are present. For anything unusual, or if a class appears to do nothing, use the CSS variable instead: every token is defined on `:root`, so `style={{ background: "var(--color-tag-blue)" }}` always resolves. Available as variables: `--color-*` (23), `--font-display|body|mono`, `--ease-out`, `--z-*`.

## Where the truth lives

- `_ds/<folder>/styles.css` and its two imports (`fonts/fonts.css`, `_ds_bundle.css`) are the real stylesheet. `_ds_bundle.css` holds the `:root` token block.
- Each component has a `<Name>.d.ts` (the exact props, with JSDoc) and a `<Name>.prompt.md` next to it. Read those before guessing at an API.

## Idiomatic example

```jsx
import { Button, EmptyState, Badge, Toaster, toast } from "cornell-craves";
import { PackageOpen } from "lucide-react";

<div className="min-h-full bg-surface p-6">
  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <h1 className="font-display text-2xl font-extrabold text-ink">Your listings</h1>
    <Badge variant="success">2 live</Badge>
  </div>

  <div className="rounded-2xl border border-border bg-surface-raised p-5">
    <EmptyState
      icon={<PackageOpen className="size-6" />}
      title="No listings yet"
      body="Post your first drop and it shows up on the feed instantly."
      actionLabel="Create your first listing"
      onAction={() => toast.success("Draft saved")}
    />
  </div>

  <p className="mt-3 text-xs text-ink-muted">
    Revenue <span className="font-mono font-bold text-ink">$812.40</span>
  </p>

  <Button className="mt-4" variant="primary">Publish drop</Button>
  <Toaster />
</div>
```
