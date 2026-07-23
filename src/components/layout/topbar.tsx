import { CompanySwitcher } from "@/components/layout/company-switcher";

export function Topbar({ title }: { title: string }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-surface px-6">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>
      <CompanySwitcher />
    </header>
  );
}
