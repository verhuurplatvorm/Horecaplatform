"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { describeIssue, type CostIssue, type CostStatus } from "@/lib/costing/status";

/** Klein label "Kostprijs onvolledig"; de tooltip noemt de regels. */
export function CostIncompleteBadge({ status, className = "" }: { status: CostStatus | null | undefined; className?: string }) {
  if (!status || status.isComplete) return null;
  const title = status.issues.slice(0, 12).map(describeIssue).join("\n") +
    (status.issues.length > 12 ? `\n… en nog ${status.issues.length - 12}` : "");
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded bg-copper/10 px-1.5 py-0.5 text-xs font-medium text-copper ${className}`}
    >
      <TriangleAlert className="h-3 w-3" />
      {status.issues.length > 0 && status.issues.every((i) => i.kind === "leeg")
        ? "Nog geen ingrediënten"
        : "Kostprijs onvolledig"}
    </span>
  );
}

/**
 * Bedrag in een overzicht: bij een onvolledige berekening als "Bekende
 * kosten" (gedempt), zodat een deelsom nooit als kostprijs leest.
 */
export function CostAmount({
  amount,
  status,
  decimals = 2,
}: {
  amount: number | null | undefined;
  status: CostStatus | null | undefined;
  decimals?: number;
}) {
  const text = amount !== null && amount !== undefined ? `€ ${amount.toFixed(decimals)}` : "—";
  if (!status || status.isComplete) return <>{text}</>;
  if (status.issues.length > 0 && status.issues.every((i) => i.kind === "leeg")) {
    return <span className="text-muted">—</span>;
  }
  return (
    <span className="inline-flex flex-col items-start leading-tight">
      <span className="text-[10px] uppercase tracking-wide text-copper">Bekende kosten</span>
      <span className="text-muted">{text}</span>
    </span>
  );
}

function issueHref(issue: CostIssue): string | null {
  if (issue.kind === "prijs" || (issue.kind === "omrekening" && issue.product_id)) {
    return issue.product_id ? `/producten/${issue.product_id}/bewerken` : null;
  }
  if (issue.sub_recipe_id) return `/halfproducten/${issue.sub_recipe_id}/bewerken`;
  if (issue.kind === "koppeling") {
    // In een onderliggend halfproduct: daar koppelen; anders via Opschonen.
    return issue.path.length > 0 && issue.recipe_id
      ? `/halfproducten/${issue.recipe_id}/bewerken`
      : "/producten/opschonen";
  }
  return null;
}

/** Lijst van regels die aandacht vragen, met een link naar waar je het oplost. */
export function CostIssueList({ status, max = 20 }: { status: CostStatus | null | undefined; max?: number }) {
  if (!status || status.isComplete) return null;
  const shown = status.issues.slice(0, max);
  return (
    <div className="rounded-md border border-copper/30 bg-copper/5 p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium text-copper">
        <TriangleAlert className="h-4 w-4" />
        Kostprijs onvolledig — {status.issues.length} regel{status.issues.length === 1 ? "" : "s"} vragen aandacht
      </p>
      <p className="mt-0.5 text-xs text-muted">
        Het bedrag is alleen de som van de bekende kosten. Foodcost en marge worden pas getoond als
        alle regels (ook in onderliggende halfproducten) een koppeling, inkoopprijs en omrekening hebben.
      </p>
      <ul className="mt-2 space-y-1">
        {shown.map((issue, i) => {
          const href = issueHref(issue);
          return (
            <li key={`${issue.line_id ?? i}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="text-foreground">{describeIssue(issue)}</span>
              {href && (
                <Link href={href} className="text-teal hover:underline">
                  oplossen →
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      {status.issues.length > max && (
        <p className="mt-1 text-xs text-muted">… en nog {status.issues.length - max} regel(s).</p>
      )}
    </div>
  );
}
