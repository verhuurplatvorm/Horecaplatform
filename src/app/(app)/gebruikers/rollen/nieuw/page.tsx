import { Topbar } from "@/components/layout/topbar";
import { RoleForm } from "@/components/roles/role-form";

export default function NieuweRolPage() {
  return (
    <>
      <Topbar title="Nieuwe rol" />
      <main className="max-w-3xl p-6">
        <RoleForm />
      </main>
    </>
  );
}
