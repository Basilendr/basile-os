"use client";
import { LANGS, isLang } from "@/services/flashcards/core";

/** Lecture à voix haute (synthèse vocale du navigateur, gratuite et hors ligne) et dictée vocale. */

export const ttsSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

/** Code de voix (es-ES…) pour un code de langue (es…). */
export const voiceOf = (lang: string) => (isLang(lang) ? LANGS[lang].voice : lang);

function pickVoice(tag: string) {
  const all = window.speechSynthesis.getVoices();
  const base = tag.split("-")[0];
  const exact = all.filter((v) => v.lang.replace("_", "-").toLowerCase() === tag.toLowerCase());
  const near = exact.length ? exact : all.filter((v) => v.lang.toLowerCase().startsWith(base));
  // Voix de meilleure qualité d'abord (« Premium », « Enhanced », voix Google).
  return near.sort((a, b) => score(b) - score(a))[0];
}
const score = (v: SpeechSynthesisVoice) => (/premium|enhanced|améliorée|natural/i.test(v.name) ? 3 : /google/i.test(v.name) ? 2 : v.localService ? 1 : 0);

/** Prononce un texte ; `onEnd` est appelé à la fin (ou tout de suite si la lecture est impossible). */
export function speak(text: string, lang: string, o: { rate?: number; onEnd?: () => void } = {}) {
  if (!ttsSupported() || !text.trim()) {
    o.onEnd?.();
    return false;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const tag = voiceOf(lang);
  u.lang = tag;
  const v = pickVoice(tag);
  if (v) u.voice = v;
  u.rate = o.rate ?? 0.92;
  u.onend = () => o.onEnd?.();
  u.onerror = () => o.onEnd?.();
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
  if (ttsSupported()) window.speechSynthesis.cancel();
}

/** Lit plusieurs phrases à la suite. Renvoie une fonction pour arrêter. */
export function speakAll(items: string[], lang: string, onIndex?: (i: number | null) => void) {
  let stopped = false;
  const next = (i: number) => {
    if (stopped || i >= items.length) return onIndex?.(null);
    onIndex?.(i);
    speak(items[i], lang, { onEnd: () => setTimeout(() => next(i + 1), 450) });
  };
  next(0);
  return () => {
    stopped = true;
    stopSpeaking();
    onIndex?.(null);
  };
}

type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  abort: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function Ctor(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export const sttSupported = () => !!Ctor();

/** Écoute l'élève prononcer un mot ou une phrase ; renvoie les transcriptions possibles. */
export function listen(lang: string): { result: Promise<string[]>; stop: () => void } {
  const C = Ctor();
  if (!C) return { result: Promise.reject(new Error("La dictée vocale n'est pas disponible sur cet appareil.")), stop: () => {} };
  const r = new C();
  r.lang = voiceOf(lang);
  r.interimResults = false;
  r.maxAlternatives = 4;
  const result = new Promise<string[]>((resolve, reject) => {
    let done = false;
    r.onresult = (e) => {
      done = true;
      const first = e.results[0];
      const out: string[] = [];
      for (let i = 0; i < first.length; i++) out.push(first[i].transcript);
      resolve(out);
    };
    r.onerror = (e) => {
      done = true;
      reject(new Error(e.error === "not-allowed" ? "Autorise le micro pour utiliser la dictée." : e.error === "no-speech" ? "Je n'ai rien entendu : réessaie." : "La dictée a échoué."));
    };
    r.onend = () => {
      if (!done) resolve([]);
    };
  });
  r.start();
  return { result, stop: () => r.abort() };
}
