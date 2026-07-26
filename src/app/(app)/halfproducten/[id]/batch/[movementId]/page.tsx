import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string; movementId: string }>;
}) {
  const { id, movementId } = await params;
  const supabase = await createClient();

  const [{ data: recipe }, { data: movement }, { data: labels }, { data: ingredients }] =
    await Promise.all([
      supabase.from("recipes").select("*").eq("id", id).single(),
      supabase.from("stock_movements").select("*").eq("id", movementId).single(),
      supabase
        .from("production_labels")
        .select("*")
        .eq("stock_movement_id", movementId)
        .order("printed_at", { ascending: false }),
      supabase
        .from("recipe_ingredients")
        .select("id, product_id, sub_recipe_id, quantity, unit_id"),
    ]);

  if (!recipe || !movement) notFound();

  const { data: allergens } = await supabase.rpc("calculate_recipe_allergens", {
    p_recipe_id: id,
  });

  return (
    <>
      <Topbar title={`Batch: ${recipe.name}`} />
      <main className="max-w-2xl space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Productiegegevens</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="font-medium">Halfproduct:</span> {recipe.name}
            </p>
            <p>
              <span className="font-medium">Geproduceerd:</span>{" "}
              {new Date(movement.created_at).toLocaleString("nl-NL")}
            </p>
            <p>
              <span className="font-medium">Hoeveelheid:</span> {movement.quantity_change}
            </p>
            <p>
              <span className="font-medium">Batchnummer:</span>{" "}
              {movement.batch_number ?? "—"}
            </p>
            {movement.expiry_date && (
              <p>
                <span className="font-medium">Houdbaar tot:</span>{" "}
                {new Date(movement.expiry_date).toLocaleDateString("nl-NL")}
              </p>
            )}
            {recipe.storage_method && (
              <p>
                <span className="font-medium">Bewaarmethode:</span> {recipe.storage_method}
              </p>
            )}
            {(allergens?.bevat?.length ?? 0) > 0 && (
              <p>
                <span className="font-medium">Allergenen:</span> Bevat{" "}
                {allergens!.bevat.join(", ")}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ingrediënten (huidige receptuur)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted">
              {ingredients?.length ?? 0} receptregel(s) — volledig receptdetail
              is te vinden op de bewerkpagina van dit halfproduct.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Afdrukgeschiedenis</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-3 font-medium">Datum</th>
                  <th className="px-5 py-3 font-medium">Aantal</th>
                  <th className="px-5 py-3 font-medium">Formaat</th>
                  <th className="px-5 py-3 font-medium">Herdruk-reden</th>
                </tr>
              </thead>
              <tbody>
                {labels?.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-5 py-3">
                      {new Date(l.printed_at).toLocaleString("nl-NL")}
                    </td>
                    <td className="px-5 py-3 tabular">{l.sticker_count}</td>
                    <td className="px-5 py-3">{l.sticker_format}</td>
                    <td className="px-5 py-3 text-muted">{l.reprint_reason ?? "—"}</td>
                  </tr>
                ))}
                {(!labels || labels.length === 0) && (
                  <tr>
                    <td colSpan={4} className="px-5 py-6 text-center text-muted">
                      Nog geen stickers afgedrukt voor deze batch.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
