import { CompanySwitcher } from "@/components/layout/company-switcher";
import { PageActionsSlot } from "@/components/layout/page-actions";
import { BackButton } from "@/components/layout/back-button";

export function Topbar({ title }: { title: string }) {
  return (
    <header className="sticky top-[var(--app-header-h,0px)] z-30 flex h-16 items-center justify-between border-b border-border bg-surface px-6 print:static">
      <div className="flex min-w-0 items-center gap-2">
        <BackButton />
        <h1 className="truncate text-lg font-semibold text-foreground">
          {title}
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <PageActionsSlot name="topbar" />
        <CompanySwitcher />
      </div>
    </header>
  );
}
