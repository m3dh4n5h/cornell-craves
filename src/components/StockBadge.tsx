import { Badge } from "@/components/ui/badge";
import { isLowStock } from "@/lib/stock";

interface StockBadgeProps {
  /** Units left, or null when the item is unlimited. */
  remaining: number | null;
  /** The club's cap for the item. */
  stock: number | null | undefined;
  /** Adds "of <item>" when one badge speaks for a multi-item drop. */
  itemName?: string;
  className?: string;
}

/**
 * "Sold out" when nothing is left, "12 left" when stock is low (under 10, or
 * under 20% of the cap), and nothing otherwise.
 */
export function StockBadge({ remaining, stock, itemName, className }: StockBadgeProps) {
  if (remaining == null || stock == null) return null;
  if (remaining <= 0) {
    return (
      <Badge variant="neutral" className={className}>
        Sold out
      </Badge>
    );
  }
  if (!isLowStock(remaining, stock)) return null;
  return (
    <Badge variant="urgent" className={className}>
      <span className="truncate">
        {remaining} left{itemName ? ` of ${itemName}` : ""}
      </span>
    </Badge>
  );
}
