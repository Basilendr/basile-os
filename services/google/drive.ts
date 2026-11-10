import "server-only";
import type { DB } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { gfetch } from "./client";
import { isServiceConnected } from "./oauth";

const API = "https://www.googleapis.com/drive/v3";
const FIELDS = "id,name,mimeType,modifiedTime,size,iconLink,webViewLink,thumbnailLink,parents,starred,owners(displayName,emailAddress),shared";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  iconLink?: string;
  webViewLink?: string;
  thumbnailLink?: string;
  parents?: string[];
  starred?: boolean;
  shared?: boolean;
  owners?: { displayName: string; emailAddress: string }[];
};

export const FOLDER_MIME = "application/vnd.google-apps.folder";
/** Formats Google natifs exportés en PDF pour l'aperçu. */
const EXPORTABLE: Record<string, string> = {
  "application/vnd.google-apps.document": "application/pdf",
  "application/vnd.google-apps.spreadsheet": "application/pdf",
  "application/vnd.google-apps.presentation": "application/pdf",
  "application/vnd.google-apps.drawing": "application/pdf",
};

async function requireDrive(db: DB, userId: string) {
  if (!(await isServiceConnected(db, userId, "drive"))) throw new AppError("not_configured", "Google Drive n'est pas connecté. Connecte-toi avec Google ou connecte Drive depuis Intégrations.");
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export async function listDrive(db: DB, userId: string, o: { folderId?: string; q?: string; view?: "my" | "recent" | "shared" | "starred"; pageToken?: string }) {
  await requireDrive(db, userId);
  const conds = ["trashed = false"];
  let orderBy = "folder,name";
  if (o.q) {
    conds.push(`(name contains '${esc(o.q)}' or fullText contains '${esc(o.q)}')`);
    orderBy = "modifiedTime desc";
  } else if (o.view === "shared") conds.push("sharedWithMe = true");
  else if (o.view === "starred") conds.push("starred = true");
  else if (o.view === "recent") {
    conds.push(`mimeType != '${FOLDER_MIME}'`);
    orderBy = "viewedByMeTime desc";
  } else conds.push(`'${esc(o.folderId || "root")}' in parents`);
  const p = new URLSearchParams({ q: conds.join(" and "), fields: `files(${FIELDS}),nextPageToken`, pageSize: "60", orderBy, supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
  if (o.q) p.delete("orderBy"); // orderBy non supporté avec fullText
  if (o.pageToken) p.set("pageToken", o.pageToken);
  const r = await gfetch<{ files: DriveFile[]; nextPageToken?: string }>(db, userId, `${API}/files?${p}`);
  return { items: r.files ?? [], nextPageToken: r.nextPageToken ?? null };
}

export async function getDriveFile(db: DB, userId: string, id: string) {
  await requireDrive(db, userId);
  return gfetch<DriveFile>(db, userId, `${API}/files/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`);
}

/** Chemin du dossier jusqu'à la racine (fil d'Ariane). */
export async function drivePath(db: DB, userId: string, folderId: string) {
  const out: { id: string; name: string }[] = [];
  let cur: string | undefined = folderId;
  for (let i = 0; cur && cur !== "root" && i < 10; i++) {
    const f: DriveFile = await getDriveFile(db, userId, cur);
    if (!f.parents?.length) break;
    out.unshift({ id: f.id, name: f.name });
    cur = f.parents?.[0];
  }
  return out;
}

/** Contenu binaire : export PDF pour les documents Google, téléchargement direct sinon. */
export async function driveContent(db: DB, userId: string, id: string) {
  const f = await getDriveFile(db, userId, id);
  if (f.mimeType === FOLDER_MIME) throw new AppError("bad_request", "C'est un dossier.");
  if (f.size && Number(f.size) > 25 * 1024 * 1024) throw new AppError("bad_request", "Fichier trop volumineux pour l'aperçu (25 Mo max). Ouvre-le dans Google Drive.");
  const exportMime = EXPORTABLE[f.mimeType];
  if (f.mimeType.startsWith("application/vnd.google-apps.") && !exportMime) throw new AppError("bad_request", "Ce type de document Google ne peut pas être prévisualisé ici. Ouvre-le dans Google Drive.");
  const url = exportMime ? `${API}/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent(exportMime)}` : `${API}/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`;
  const res = await gfetch<Response>(db, userId, url, { raw: true });
  const data = Buffer.from(await res.arrayBuffer());
  return { file: f, data, mimeType: exportMime ?? f.mimeType, name: exportMime ? `${f.name}.pdf` : f.name };
}
