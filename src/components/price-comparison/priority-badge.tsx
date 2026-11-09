import { cn } from "@/lib/utils";
import { PRIORITY_META } from "@/lib/price-comparison";
import type { PriceComparisonRow } from "@/lib/types/database";

export function PriorityBadge({
  priority,
}: {
  priority: PriceComparisonRow["priority"];
}) {
  const meta = PRIORITY_META[priority];
  return (
    <span
      className={cn(
        "inline-block whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold",
        meta.className,
      )}
    >
      {meta.short}
    </span>
  );
}
