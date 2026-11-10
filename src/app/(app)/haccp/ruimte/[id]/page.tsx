import { RuimteVandaag } from "@/components/haccp/ruimte-vandaag";

/** Pagina achter de QR-code van een ruimte: alleen de taken van die ruimte. */
export default async function HaccpRuimtePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RuimteVandaag areaId={id} />;
}
