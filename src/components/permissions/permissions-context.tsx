"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ModulePermission {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canViewFinancial: boolean;
}

interface PermissionsContextValue {
  loading: boolean;
  isGroupAdmin: boolean;
  /** Groepsbeheerders zien/mogen alles — deze functie geeft voor hen altijd volledige rechten terug. */
  can: (moduleKey: string | null) => ModulePermission;
}

const FULL_ACCESS: ModulePermission = {
  canView: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
  canViewFinancial: true,
};

const NO_ACCESS: ModulePermission = {
  canView: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
  canViewFinancial: false,
};

const PermissionsContext = createContext<PermissionsContextValue>({
  loading: true,
  isGroupAdmin: false,
  can: () => FULL_ACCESS,
});

export function usePermissions() {
  return useContext(PermissionsContext);
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [isGroupAdmin, setIsGroupAdmin] = useState(false);
  const [byModule, setByModule] = useState<Map<string, ModulePermission>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from("user_profiles")
        .select("is_group_admin")
        .eq("id", user.id)
        .single();

      if (cancelled) return;

      if (profile?.is_group_admin) {
        setIsGroupAdmin(true);
        setLoading(false);
        return;
      }

      // Niet-beheerders: rechten ophalen via alle bedrijven waar deze
      // gebruiker toegang toe heeft, per module het meest ruime recht
      // toepassen (heeft iemand via één bedrijf "bekijken", dan ziet
      // die dat onderdeel — verfijning per bedrijf gebeurt verderop in
      // de pagina's zelf via de bedrijfsselector).
      const { data: access } = await supabase
        .from("user_company_access")
        .select("role_id")
        .eq("user_id", user.id);

      const roleIds = [...new Set((access ?? []).map((a) => a.role_id))];
      if (roleIds.length === 0) {
        if (!cancelled) setLoading(false);
        return;
      }

      const { data: permissions } = await supabase
        .from("role_permissions")
        .select("module_key, can_view, can_create, can_edit, can_delete, can_view_financial")
        .in("role_id", roleIds);

      if (cancelled) return;

      const map = new Map<string, ModulePermission>();
      for (const p of permissions ?? []) {
        const existing = map.get(p.module_key);
        map.set(p.module_key, {
          canView: existing?.canView || p.can_view,
          canCreate: existing?.canCreate || p.can_create,
          canEdit: existing?.canEdit || p.can_edit,
          canDelete: existing?.canDelete || p.can_delete,
          canViewFinancial: existing?.canViewFinancial || p.can_view_financial,
        });
      }
      setByModule(map);
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<PermissionsContextValue>(
    () => ({
      loading,
      isGroupAdmin,
      can: (moduleKey: string | null) => {
        if (isGroupAdmin || moduleKey === null) return FULL_ACCESS;
        return byModule.get(moduleKey) ?? NO_ACCESS;
      },
    }),
    [loading, isGroupAdmin, byModule]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}
