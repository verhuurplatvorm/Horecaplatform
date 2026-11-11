"use client";

import { X } from "lucide-react";
import { StaffSelect } from "@/components/haccp/staff-select";
import type { StaffSession } from "@/lib/haccp/cleaning";

/**
 * Pop-up "Wie werkt er?": keuzelijst met medewerkers + veld om een collega
 * toe te voegen. Geen pincode (collegiale werkplek).
 */
export function StaffSwitcher({
  companyId,
  accountName,
  excludeShared,
  onClose,
  onChosen,
}: {
  companyId: string;
  accountName: string | null;
  excludeShared?: boolean;
  onClose: () => void;
  onChosen: (session: StaffSession | null) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy/60 p-4 sm:p-8">
      <div className="w-full max-w-md rounded-xl border border-border bg-background shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold text-foreground">
            Wie werkt er?
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-2 text-muted hover:bg-surface"
            aria-label="Sluiten"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <StaffSelect
            companyId={companyId}
            value={null}
            excludeShared={excludeShared}
            onChosen={(s) => onChosen(s)}
          />
          {accountName && (
            <button
              onClick={() => onChosen(null)}
              className="w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted hover:text-foreground"
            >
              Registreren als ingelogd account ({accountName})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
