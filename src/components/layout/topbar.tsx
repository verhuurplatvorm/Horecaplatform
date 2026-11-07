import { CompanySwitcher } from "@/components/layout/company-switcher";
import { PageActionsSlot } from "@/components/layout/page-actions";

export function Topbar({ title }: { title: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <div className="flex items-center gap-3">
        <PageActionsSlot name="topbar" />
        <CompanySwitcher />
      </div>
    </header>
  );
}
