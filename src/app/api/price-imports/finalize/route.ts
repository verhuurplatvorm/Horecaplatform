import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { applyMapping, type RawTable } from "@/lib/price-import/parse";
import { createImportBatch } from "@/lib/price-import/create-batch";

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
    return NextResponse.json(
      { error: "Geen gebruikersprofiel gevonden." },
      { status: 400 }
    );
  }

  const body = await request.json();
  const { supplierId, companyId, originalFilename, headers, rows, mapping } = body ?? {};

  if (
    typeof supplierId !== "string" ||
    !supplierId ||
    !Array.isArray(headers) ||
    !Array.isArray(rows) ||
    typeof mapping !== "object"
  ) {
    return NextResponse.json(
      { error: "Onvolledige gegevens voor import." },
      { status: 400 }
    );
  }

  const canonicalFieldsFound = new Set(Object.values(mapping));
  const hasIdentifier =
    canonicalFieldsFound.has("ean") ||
    canonicalFieldsFound.has("articleNumber") ||
    canonicalFieldsFound.has("combinedLine") ||
    canonicalFieldsFound.has("description");
  const hasPrice = canonicalFieldsFound.has("purchasePrice");
  if (!hasIdentifier || !hasPrice) {
    return NextResponse.json(
      {
        error:
          "Koppel minimaal een kolom aan een artikel (EAN-code, artikelnummer, artikelnaam of artikelregel), en een kolom aan Prijs.",
      },
      { status: 400 }
    );
  }

  const table: RawTable = { headers, rows };
  const parsedRows = applyMapping(table, mapping as Record<string, string>);

  const result = await createImportBatch(supabase, {
    groupId: profile.group_id,
    supplierId,
    companyId: typeof companyId === "string" && companyId ? companyId : null,
    originalFilename: typeof originalFilename === "string" ? originalFilename : "import",
    importedBy: user.id,
    parsedRows,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ batchId: result.batchId });
}
