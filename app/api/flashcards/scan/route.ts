import { after } from "next/server";
import { route } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { createScanDeck, runExtraction, type Scan } from "@/services/flashcards/flashcards";

export const maxDuration = 300;

/** Photos (ou PDF) d'un cours : l'IA les retranscrit et en tire le vocabulaire. */
export const POST = route({ rate: [10, 60_000] }, async ({ db, user, req }) => {
  const form = await req.formData().catch(() => {
    throw new AppError("bad_request", "Formulaire invalide");
  });
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const scans: Scan[] = [];
  for (const f of files.slice(0, 9)) scans.push({ data: Buffer.from(await f.arrayBuffer()), mimeType: f.type || "image/jpeg", name: f.name || "photo.jpg" });
  const text = (k: string) => (typeof form.get(k) === "string" ? String(form.get(k)) : undefined);
  const r = await createScanDeck(db, user.id, scans, { title: text("title"), focus: text("focus"), lang: text("lang") });
  after(() => runExtraction(db, user.id, r.id, scans));
  return r;
});
