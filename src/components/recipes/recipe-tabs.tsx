import Link from "next/link";

/** Tabbladen bovenaan Gerechten: alle gerechten / partijgerechten. */
export function RecipeTabs({ active }: { active: "alle" | "partij" }) {
  const tabs = [
    { key: "alle", label: "Gerechten", href: "/recepturen" },
    { key: "partij", label: "Partijgerechten", href: "/recepturen/partij" },
  ] as const;
  return (
    <div className="flex gap-1 border-b border-border px-4 md:px-6">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
            active === t.key
              ? "border-teal text-teal"
              : "border-transparent text-muted hover:text-foreground"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
