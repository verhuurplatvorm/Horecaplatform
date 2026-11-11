import { randomBytes, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Medewerker toevoegen zonder e-mailadres (alleen een naam), zodat hij in
 * de keuzelijst "Medewerker" staat bij schoonmaak (HACCP) en stickers.
 * Collegiale werkplek: geen pincode nodig (pincode is optioneel).
 *
 * Er wordt een gewone gebruiker aangemaakt (zodat registraties aan een
 * echte persoon gekoppeld zijn), met een niet-bestaand e-mailadres en een
 * willekeurig wachtwoord dat nergens wordt bewaard: deze persoon kan dus
 * niet zelf inloggen. Rol: Medewerker, alleen voor het gekozen bedrijf.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const companyId = typeof body?.companyId === "string" ? body.companyId : "";
  const fullName =
    typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const pin = typeof body?.pin === "string" ? body.pin : "";

  if (!companyId || !fullName) {
    return NextResponse.json({ error: "Vul een naam in." }, { status: 400 });
  }
  // Een echte persoon, geen verzamelnaam (HACCP: wie heeft het gedaan?).
  const generic =
    /^(keuken|onbekend|iedereen|team|personeel|medewerker|bediening|bar|chef|kok|test|algemeen|het strand|zomers)\b/i;
  if (fullName.length < 2 || generic.test(fullName)) {
    return NextResponse.json(
      {
        error: "Vul de naam van een persoon in (geen 'Keuken' of 'Onbekend').",
      },
      { status: 400 },
    );
  }
  if (pin && !/^\d{4}$/.test(pin)) {
    return NextResponse.json(
      { error: "Pincode moet uit 4 cijfers bestaan." },
      { status: 400 },
    );
  }

  // Iedereen die mag afmelden of stickers mag afdrukken, mag een collega
  // toevoegen.
  const checks = await Promise.all(
    (
      [
        ["haccp", "create"],
        ["stickers", "create"],
        ["haccp_plan", "edit"],
      ] as const
    ).map(([m, a]) =>
      supabase.rpc("has_module_permission", {
        p_company_id: companyId,
        p_module_key: m,
        p_action: a,
      }),
    ),
  );
  if (!checks.some((c) => c.data === true)) {
    return NextResponse.json(
      { error: "Je hebt geen recht om medewerkers toe te voegen." },
      { status: 403 },
    );
  }

  const { data: me } = await supabase
    .from("user_profiles")
    .select("group_id")
    .eq("id", user.id)
    .single();
  if (!me?.group_id)
    return NextResponse.json(
      { error: "Profiel niet gevonden." },
      { status: 400 },
    );

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Serverconfiguratie ontbreekt.",
      },
      { status: 500 },
    );
  }

  // Bestaat deze naam al? Dan geen dubbele medewerker aanmaken.
  const { data: existing } = await admin
    .from("user_profiles")
    .select("id, full_name, is_active")
    .eq("group_id", me.group_id)
    .ilike("full_name", fullName.replace(/[%_]/g, ""));
  const same = (existing ?? []).find(
    (u) =>
      u.is_active &&
      u.full_name.trim().toLowerCase() === fullName.toLowerCase(),
  );
  if (same) {
    const { data: access } = await admin
      .from("user_company_access")
      .select("user_id")
      .eq("user_id", same.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (!access) {
      const { data: kok } = await admin
        .from("roles")
        .select("id")
        .eq("group_id", me.group_id)
        .eq("key", "kok")
        .single();
      if (kok)
        await admin.from("user_company_access").insert({
          user_id: same.id,
          company_id: companyId,
          role_id: kok.id,
          granted_by: user.id,
        });
    }
    return NextResponse.json({ userId: same.id, existed: true });
  }

  const { data: role } = await admin
    .from("roles")
    .select("id")
    .eq("group_id", me.group_id)
    .eq("key", "kok")
    .single();
  if (!role)
    return NextResponse.json(
      { error: "Rol 'Medewerker' niet gevonden." },
      { status: 500 },
    );

  const email = `medewerker-${randomUUID()}@geen-email.culilogic.app`;
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: randomBytes(32).toString("hex"),
      email_confirm: true,
      user_metadata: { alleen_tablet: true, full_name: fullName },
    });
  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Aanmaken mislukt." },
      { status: 400 },
    );
  }
  const newId = created.user.id;

  const cleanup = async (msg: string) => {
    await admin.from("user_company_access").delete().eq("user_id", newId);
    await admin.from("user_profiles").delete().eq("id", newId);
    await admin.auth.admin.deleteUser(newId);
    return NextResponse.json({ error: msg }, { status: 500 });
  };

  const { error: profileError } = await admin.from("user_profiles").insert({
    id: newId,
    group_id: me.group_id,
    full_name: fullName,
    email,
    is_group_admin: false,
  });
  if (profileError)
    return cleanup("Profiel aanmaken mislukt: " + profileError.message);

  const { error: accessError } = await admin
    .from("user_company_access")
    .insert({
      user_id: newId,
      company_id: companyId,
      role_id: role.id,
      granted_by: user.id,
    });
  if (accessError)
    return cleanup("Toegang instellen mislukt: " + accessError.message);

  // Optionele pincode (wordt niet meer gevraagd, alleen voor oude schermen).
  if (pin) {
    const { error: pinError } = await supabase.rpc("haccp_set_pin", {
      p_company_id: companyId,
      p_user_id: newId,
      p_pin: pin,
    });
    if (pinError)
      return cleanup("Pincode instellen mislukt: " + pinError.message);
  }

  return NextResponse.json({ userId: newId });
}
