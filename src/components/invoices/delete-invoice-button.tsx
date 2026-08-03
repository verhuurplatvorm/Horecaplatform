"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export function DeleteInvoiceButton({
  batchId,
  filename,
}: {
  batchId: string;
  filename: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        `Factuur "${filename}" definitief verwijderen? Dit verwijdert ook alle regels van deze factuur en kan niet ongedaan worden gemaakt. Al toegepaste prijzen op producten blijven wel gewoon staan.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError, data } = await supabase
      .from("price_import_batches")
      .delete()
      .eq("id", batchId)
      .select("id");
    setDeleting(false);

    if (deleteError) {
      setError("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError(
        "Verwijderen is niet gelukt — je hebt hier mogelijk geen rechten voor (groepsbrede facturen kunnen alleen door een groepsbeheerder verwijderd worden)."
      );
      return;
    }
    router.refresh();
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Factuur verwijderen"
        className="text-muted hover:text-danger disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
