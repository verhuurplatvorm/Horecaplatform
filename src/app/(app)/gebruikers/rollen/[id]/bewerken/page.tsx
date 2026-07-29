import { notFound } from "next/navigation";
import { Topbar } from "@/components/layout/topbar";
import { RoleForm } from "@/components/roles/role-form";
import { createClient } from "@/lib/supabase/server";
import type { Role, RolePermission } from "@/lib/types/database";

export default async function BewerkRolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: role }, { data: permissions }] = await Promise.all([
    supabase.from("roles").select("*").eq("id", id).single(),
    supabase.from("role_permissions").select("*").eq("role_id", id),
  ]);

  if (!role) notFound();

  return (
    <>
      <Topbar title={`Bewerken: ${role.name}`} />
      <main className="max-w-3xl p-6">
        <RoleForm
          initialRole={role as Role}
          initialPermissions={(permissions as RolePermission[]) ?? []}
        />
      </main>
    </>
  );
}
