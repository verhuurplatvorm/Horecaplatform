import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface KpiTileProps {
  label: string;
  value: string;
  deltaPct?: number | null;
  deltaLabel?: string;
  tone?: "neutral" | "good" | "bad";
}

export function KpiTile({
  label,
  value,
  deltaPct,
  deltaLabel = "t.o.v. vorig jaar",
  tone = "neutral",
}: KpiTileProps) {
  const isUp = (deltaPct ?? 0) > 0;
  const isDown = (deltaPct ?? 0) < 0;

  const deltaColor =
    tone === "bad"
      ? isUp
        ? "text-danger"
        : "text-success"
      : isUp
      ? "text-success"
      : isDown
      ? "text-danger"
      : "text-muted";

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="tabular text-2xl font-semibold text-foreground">
          {value}
        </div>
        {deltaPct !== undefined && deltaPct !== null && (
          <div className={cn("mt-1 flex items-center gap-1 text-xs", deltaColor)}>
            {isUp ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : isDown ? (
              <ArrowDownRight className="h-3.5 w-3.5" />
            ) : (
              <Minus className="h-3.5 w-3.5" />
            )}
            <span className="tabular">
              {deltaPct > 0 ? "+" : ""}
              {deltaPct.toFixed(1)}%
            </span>
            <span className="text-muted">{deltaLabel}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
