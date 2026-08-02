import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractMenuFromPdf } from "@/lib/menu-import/claude-menu-ocr";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("group_id")
    .eq("id", user.id)
    .single();
  if (!profile) {
    return NextResponse.json({ error: "Geen gebruikersprofiel gevonden." }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen." }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Alleen PDF-bestanden worden ondersteund." },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const storagePath = `${profile.group_id}/${Date.now()}-${file.name}`;
  await supabase.storage.from("menukaarten").upload(storagePath, buffer, {
    contentType: "application/pdf",
  });

  let dishes;
  try {
    dishes = await extractMenuFromPdf(buffer);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Kan de menukaart niet uitlezen." },
      { status: 500 }
    );
  }

  if (dishes.length === 0) {
    return NextResponse.json(
      { error: "Geen gerechten herkend op deze menukaart. Controleer het bestand." },
      { status: 422 }
    );
  }

  const dishesWithMatches = await Promise.all(
    dishes.map(async (dish) => {
      const { data: candidates } = await supabase.rpc("match_recipe_by_name", {
        p_group_id: profile.group_id,
        p_name: dish.name,
      });
      return { ...dish, candidates: candidates ?? [] };
    })
  );

  return NextResponse.json({ dishes: dishesWithMatches, storagePath });
}
