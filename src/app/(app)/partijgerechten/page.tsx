import { redirect } from "next/navigation";

// Oude adres: het overzicht staat nu als tabblad onder Gerechten.
export default function PartijgerechtenRedirect() {
  redirect("/recepturen/partij");
}
