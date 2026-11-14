"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { usePermissions } from "@/components/permissions/permissions-context";

/**
 * Operator: alleen de keukenschermen. Overzichten met bewerk-/beheer-
 * functies (lijsten, nieuw, importeren, beheer, inkoop) sturen door naar
 * het operator-startscherm. Dit is gemak; de echte beveiliging zit in de
 * database (operators kunnen daar niets wijzigen).
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ALLOWED: RegExp[] = [
  /^\/operator(\/|$)/,
  new RegExp(`^/recepturen/${UUID}/bewerken/?$`, "i"),
  new RegExp(
    `^/halfproducten/${UUID}(/bewerken|/producties|/sticker(/.*)?|/batch(/.*)?)?/?$`,
    "i",
  ),
  new RegExp(`^/producten/${UUID}/bewerken/?$`, "i"),
  /^\/stickers(\/|$)/,
  /^\/keukenlijsten(\/|$)/,
  /^\/voorraad(\/|$)/,
  /^\/afval(\/|$)/,
  /^\/haccp(\/|$)/,
];

export function OperatorGuard() {
  const { isOperator, loading } = usePermissions();
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const allowed = ALLOWED.some((re) => re.test(pathname));

  useEffect(() => {
    if (!loading && isOperator && !allowed) router.replace("/operator");
  }, [loading, isOperator, allowed, router]);

  return null;
}
