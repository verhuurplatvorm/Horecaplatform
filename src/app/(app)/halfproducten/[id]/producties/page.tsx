import { redirect } from "next/navigation";

/**
 * De productiehistorie stond hier als losse pagina én als blok onderaan
 * het halfproduct zelf (ProductiesGeschiedenis) — dezelfde lijst, twee
 * plekken. De losse pagina is opgeheven; deze route stuurt door naar het
 * halfproduct, waar de historie onderaan staat. Bestaande links en
 * bladwijzers blijven zo gewoon werken.
 */
export default async function ProductiesRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/halfproducten/${id}/bewerken#producties`);
}
