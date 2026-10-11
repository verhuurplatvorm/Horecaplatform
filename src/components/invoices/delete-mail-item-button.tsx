"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type Status =
  | "nieuw_ontvangen"
  | "wordt_verwerkt"
  | "verwerkt"
  | "wacht_op_leverancier"
  | "fout"
  | "dubbele_factuur"
  | "afgewezen";

// Wat er bij verwijderen gebeurt, per status. Verwijderd wordt ALLEEN de
// regel in het mailbox-overzicht (inbound_invoice_queue). Een daaruit
// aangemaakte prijsimport/factuur en al doorgevoerde prijzen blijven staan.
function consequence(status: Status): string {
  switch (status) {
    case "verwerkt":
      return "De prijsimport op het Facturen-scherm en alle doorgevoerde prijzen blijven gewoon staan. Let op: mail je dezelfde factuur later opnieuw, dan wordt hij niet meer als dubbel herkend en opnieuw verwerkt.";
    case "wacht_op_leverancier":
      return "Deze factuur is nog niet verwerkt. Na verwijderen kun je hem hier niet meer afronden.";
    case "wordt_verwerkt":
    case "nieuw_ontvangen":
      return "Deze factuur staat nog als 'wordt verwerkt'. Verwijder hem alleen als hij vastzit.";
    default:
      return "Alleen deze regel in het overzicht wordt verwijderd.";
  }
}

export function DeleteMailItemButton({
  id,
  filename,
  status,
}: {
  id: string;
  filename: string;
  status: Status;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (
      !window.confirm(
        `"${filename}" uit het Factuurmailbox-overzicht verwijderen?\n\n${consequence(status)}\n\nDit kan niet ongedaan worden gemaakt.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    const supabase = createClient();
    const { error: deleteError, data } = await supabase
      .from("inbound_invoice_queue")
      .delete()
      .eq("id", id)
      .select("id");
    setDeleting(false);

    if (deleteError) {
      setError("Verwijderen mislukt: " + deleteError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError("Verwijderen is niet gelukt — je hebt hier mogelijk geen rechten voor.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Uit overzicht verwijderen"
        className="text-muted hover:text-danger disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
      {error && <span className="max-w-[12rem] text-xs text-danger">{error}</span>}
    </div>
  );
}
