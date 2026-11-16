"use client";
import { useEffect, useState } from "react";
import { Snail, Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS, LANG_CODES, isLang } from "@/services/flashcards/core";
import { speak, ttsSupported } from "@/lib/client/speech";
import { useToast } from "@/components/ui/toast";
import { Switch } from "@/components/ui/input";

export type DeckSummary = {
  id: string;
  title: string;
  subject: string | null;
  lang: string;
  source: string;
  status: string;
  error: string | null;
  guide: string;
  createdAt: string;
  total: number;
  fresh: number;
  due: number;
  mastered: number;
};
export type VocabOverview = {
  date: string;
  ready: { drive: boolean; ai: boolean };
  decks: DeckSummary[];
  totals: { due: number; fresh: number; total: number; mastered: number; studiedToday: number };
};
export type FlashCard = {
  id: string;
  term: string;
  translation: string;
  example: string | null;
  exampleFr: string | null;
  note: string | null;
  kind: string | null;
  state: string;
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
  dueDate: string | null;
  due: boolean;
};

export const langLabel = (l: string) => (isLang(l) ? LANGS[l].label : l);
export const langFlag = (l: string) => (isLang(l) ? LANGS[l].flag : "🌍");
export const LANG_OPTIONS = LANG_CODES.map((c) => ({ value: c, label: `${LANGS[c].flag} ${LANGS[c].label}` }));

export function useRun() {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>, failTitle = "Action impossible") => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ kind: "error", title: failTitle, description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

/** Bouton haut-parleur : prononce le texte dans la langue étudiée (voix du téléphone ou de l'ordinateur). */
export function Speak({ text, lang, className, size = "md", slow }: { text: string; lang: string; className?: string; size?: "sm" | "md" | "lg"; slow?: boolean }) {
  const [ok, setOk] = useState(false);
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOk(ttsSupported());
    // Les voix se chargent après coup sur certains navigateurs.
    if (ttsSupported()) window.speechSynthesis.getVoices();
  }, []);
  if (!ok || !text) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        setOn(true);
        speak(text, lang, { rate: slow ? 0.6 : undefined, onEnd: () => setOn(false) });
      }}
      className={cn(
        "focus-ring grid shrink-0 place-items-center rounded-full border border-line bg-bg/60 text-fg-2 transition-colors hover:bg-raised hover:text-fg active:scale-90",
        size === "sm" ? "size-7" : size === "lg" ? "size-12" : "size-9",
        on && "border-accent/50 text-accent",
        className,
      )}
      aria-label={`Écouter « ${text} »${slow ? " lentement" : ""}`}
      title={slow ? "Écouter lentement" : "Écouter"}
    >
      {slow ? <Snail className={size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4"} /> : <Volume2 className={size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4"} />}
    </button>
  );
}

/** État d'une carte en mots simples. */
export function cardState(c: Pick<FlashCard, "state" | "interval" | "due">) {
  if (c.state === "new") return { label: "Nouveau", tone: "accent" as const };
  if (c.due) return { label: "À revoir", tone: "warning" as const };
  if (c.interval >= 21) return { label: "Su", tone: "success" as const };
  return { label: `Dans ${c.interval} j`, tone: "neutral" as const };
}

/** Réduit une photo (≤ 2000 px, JPEG) avant l'envoi : plus rapide et sous la limite d'envoi du site. */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Interrupteur avec son libellé visible (cliquable). */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Switch checked={checked} onChange={onChange} label={label} />
      <button type="button" className="text-[13px] text-fg-2" onClick={() => onChange(!checked)}>
        {label}
      </button>
    </span>
  );
}
