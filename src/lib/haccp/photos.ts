import { createClient } from "@/lib/supabase/client";

const BUCKET = "haccp";
const MAX_SIDE = 1600;

/** Verkleint een foto in de browser tot max. 1600 px (JPEG), zodat uploaden op een tablet snel gaat. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8),
    );
    return blob ?? file;
  } catch {
    return file;
  }
}

/**
 * Uploadt een foto naar de privé-opslag en legt hem vast bij een taak
 * (occurrence) of afwijking. Foto's kunnen daarna niet worden vervangen
 * of verwijderd.
 */
export async function uploadHaccpPhoto(opts: {
  companyId: string;
  file: File;
  occurrenceId?: string | null;
  deviationId?: string | null;
  sessionId?: string | null;
}): Promise<{ error: string | null }> {
  const supabase = createClient();
  const blob = await shrink(opts.file);
  const id = crypto.randomUUID();
  const month = new Date().toISOString().slice(0, 7);
  const path = `${opts.companyId}/${month}/${id}.jpg`;

  const up = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: blob.type || "image/jpeg",
    upsert: false,
  });
  if (up.error) return { error: `Foto uploaden mislukt: ${up.error.message}` };

  const { error } = await supabase.rpc("haccp_add_photo", {
    p_photo_id: id,
    p_company_id: opts.companyId,
    p_storage_path: path,
    p_occurrence_id: opts.occurrenceId ?? null,
    p_deviation_id: opts.deviationId ?? null,
    p_session_id: opts.sessionId ?? null,
  });
  return { error: error ? error.message : null };
}

/** Tijdelijke links (1 uur) om foto's te bekijken. */
export async function signedPhotoUrls(
  paths: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data } = await createClient()
    .storage.from(BUCKET)
    .createSignedUrls(paths, 3600);
  for (const d of data ?? []) {
    if (d.path && d.signedUrl) out.set(d.path, d.signedUrl);
  }
  return out;
}
