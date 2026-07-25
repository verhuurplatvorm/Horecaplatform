"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import type { Company } from "@/lib/types/database";

const STORAGE_KEY = "horeca:selected-company-ids";

export type CompanyScope =
  | { mode: "group" } // "alle bedrijven"
  | { mode: "companies"; ids: string[] }; // 1 of meerdere geselecteerde bedrijven

interface CompanyContextValue {
  companies: Company[];
  loading: boolean;
  scope: CompanyScope;
  setScope: (scope: CompanyScope) => void;
  /** Bedrijven die binnen de huidige scope vallen (voor queries/filters). */
  activeCompanyIds: string[];
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScopeState] = useState<CompanyScope>(() => {
    // Lazy init (i.p.v. setState in een effect) leest de eerder gekozen
    // bedrijfsselectie uit localStorage vóór de eerste render.
    if (typeof window === "undefined") return { mode: "group" };
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return { mode: "group" };
    try {
      const ids: string[] = JSON.parse(stored);
      return ids.length > 0 ? { mode: "companies", ids } : { mode: "group" };
    } catch {
      return { mode: "group" };
    }
  });

  useEffect(() => {
    let cancelled = false;

    async function loadCompanies() {
      setLoading(true);
      const supabase = createClient();
      // RLS zorgt dat hier alleen bedrijven binnen bereik terugkomen
      // (spec §2, §31): group admins zien alles, anderen alleen wat
      // via user_company_access is toegekend.
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("is_active", true)
        .order("name");

      if (!cancelled) {
        if (!error && data) setCompanies(data as Company[]);
        setLoading(false);
      }
    }

    loadCompanies();
    return () => {
      cancelled = true;
    };
  }, []);

  function setScope(next: CompanyScope) {
    setScopeState(next);
    if (next.mode === "companies") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.ids));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }

  const activeCompanyIds = useMemo(() => {
    if (scope.mode === "group") return companies.map((c) => c.id);
    return scope.ids;
  }, [scope, companies]);

  const value: CompanyContextValue = {
    companies,
    loading,
    scope,
    setScope,
    activeCompanyIds,
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompanyScope() {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompanyScope moet binnen <CompanyProvider> gebruikt worden");
  }
  return ctx;
}
