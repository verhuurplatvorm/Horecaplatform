import { redirect } from "next/navigation";

/**
 * Deze pagina was een tussenscherm met drie doorklik-kaarten die exact
 * hetzelfde aanboden als de Financieel-tabbalk erboven — een extra klik
 * zonder eigen informatie. De route blijft bestaan voor bestaande links
 * en stuurt door naar het eerste echte scherm.
 */
export default function FinancieelIndex() {
  redirect("/financieel/bedrijven");
}
