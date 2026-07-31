import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const { data: requesterProfile } = await supabase
    .from("user_profiles")
    .select("group_id, is_group_admin")
    .eq("id", user.id)
    .single();

  if (!requesterProfile?.is_group_admin) {
    return NextResponse.json(
      { error: "Alleen groepsbeheerders mogen gebruikers uitnodigen." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { fullName, email, isGroupAdmin, password } = body ?? {};

  if (
    typeof fullName !== "string" ||
    !fullName.trim() ||
    typeof email !== "string" ||
    !email.trim()
  ) {
    return NextResponse.json(
      { error: "Naam en e-mailadres zijn verplicht." },
      { status: 400 }
    );
  }

  if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
    return NextResponse.json(
      { error: "Wachtwoord moet minimaal 8 tekens zijn." },
      { status: 400 }
    );
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Serverconfiguratie ontbreekt." },
      { status: 500 }
    );
  }

  const { data: invited, error: inviteError } = password
    ? await admin.auth.admin.createUser({
        email: email.trim(),
        password,
        email_confirm: true, // meteen bruikbaar, geen bevestigingsmail nodig
      })
    : await admin.auth.admin.inviteUserByEmail(email.trim(), {
        redirectTo: `${new URL(request.url).origin}/auth/callback`,
      });

  if (inviteError || !invited.user) {
    return NextResponse.json(
      {
        error:
          inviteError?.message ??
          "Kan geen uitnodiging versturen. Mogelijk bestaat dit e-mailadres al.",
      },
      { status: 400 }
    );
  }

  const { error: profileError } = await admin.from("user_profiles").insert({
    id: invited.user.id,
    group_id: requesterProfile.group_id,
    full_name: fullName.trim(),
    email: email.trim(),
    is_group_admin: Boolean(isGroupAdmin),
  });

  if (profileError) {
    // De auth-uitnodiging is al verstuurd; het profiel alsnog opruimen
    // zodat er geen "kale" auth-user zonder profiel achterblijft.
    await admin.auth.admin.deleteUser(invited.user.id);
    return NextResponse.json(
      { error: "Kan gebruikersprofiel niet aanmaken: " + profileError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ userId: invited.user.id });
}
