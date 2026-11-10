"use client";
import { api } from "./api";

/** L'app tourne-t-elle depuis l'écran d'accueil (plein écran) ? */
export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const isIos = () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function registerSw() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
}

function b64ToBytes(b64: string) {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Demande l'autorisation puis abonne cet appareil (doit partir d'un appui de l'utilisateur). */
export async function enablePush() {
  if (!pushSupported()) throw new Error(isIos() && !isStandalone() ? "Sur iPhone, installe d'abord l'app sur l'écran d'accueil puis ouvre-la depuis son icône." : "Ce navigateur ne gère pas les notifications.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications refusées. Autorise-les dans Réglages → Notifications → Basile OS.");
  const reg = (await registerSw()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const { publicKey } = await api.get<{ publicKey: string }>("/api/push");
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await api.post("/api/push", { endpoint: json.endpoint, keys: json.keys, device: isIos() ? "iPhone" : navigator.platform || "Appareil" });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.del(`/api/push?endpoint=${encodeURIComponent(sub.endpoint)}`).catch(() => null);
  await sub.unsubscribe();
}
