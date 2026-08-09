import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentGroupId } from "@/lib/supabase/current-group";
import { parseMultiSupplierExcel } from "@/lib/product-import/parse-multi-supplier";
import { buildSupplierMatchMap } from "@/lib/product-import/match-supplier";

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });
  }

  const groupId = await getCurrentGroupId(supabase);
  if (!groupId) {
    return NextResponse.json({ error: "Kan groep niet bepalen." }, { status: 400 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Geen bestand ontvangen." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let rows;
  try {
    rows = parseMultiSupplierExcel(buffer);
  } catch (err) {
    console.error("[product-import] Kan bestand niet lezen:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `Kan bestand niet lezen: ${err.message}`
            : "Kan bestand niet lezen.",
      },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "Geen ingrediëntregels herkend in dit bestand." },
      { status: 422 }
    );
  }

  console.log(
    `[product-import] ${rows.length} productregel(s) herkend, ${new Set(rows.map((r) => r.supplierNameRaw)).size} leverancier(s).`
  );

  const rawSupplierNames = [...new Set(rows.map((r) => r.supplierNameRaw))];
  const matchMap = await buildSupplierMatchMap(supabase, groupId, rawSupplierNames);

  const supplierGroups = await Promise.all(
    rawSupplierNames.map(async (rawName) => {
      const match = matchMap.get(rawName)!;
      const rowCount = rows.filter((r) => r.supplierNameRaw === rawName).length;
      let candidates: { supplier_id: string; supplier_name: string; similarity_score: number }[] = [];
      if (!match.matched) {
        const { data } = await supabase.rpc("match_supplier_by_name", {
          p_group_id: groupId,
          p_name: rawName,
        });
        candidates = data ?? [];
      }
      return {
        rawName,
        rowCount,
        matched: match.matched,
        supplierId: match.supplierId,
        candidates,
      };
    })
  );

  return NextResponse.json({ rows, supplierGroups });
}
