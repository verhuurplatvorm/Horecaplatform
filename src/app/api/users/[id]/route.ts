import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetUserId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const { data: requesterProfile } = await supabase
    .from("user_profiles")
    .select("is_group_admin, group_id")
    .eq("id", user.id)
    .single();

  if (!requesterProfile?.is_group_admin) {
    return NextResponse.json(
      { error: "Alleen groepsbeheerders mogen gebruikers verwijderen." },
      { status: 403 }
    );
  }

  if (targetUserId === user.id) {
    return NextResponse.json(
      { error: "Je kunt jezelf niet verwijderen." },
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

  const { data: targetProfile } = await admin
    .from("user_profiles")
    .select("group_id")
    .eq("id", targetUserId)
    .single();

  if (!targetProfile || targetProfile.group_id !== requesterProfile.group_id) {
    return NextResponse.json({ error: "Gebruiker niet gevonden." }, { status: 404 });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    return NextResponse.json(
      { error: "Verwijderen mislukt: " + deleteError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}
