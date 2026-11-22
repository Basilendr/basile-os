"use client";
import { focusManager } from "@tanstack/react-query";

/** Après 5 minutes sans souris, clavier ni toucher, l'appli arrête d'interroger le serveur. */
const IDLE_AFTER = 5 * 60_000;
const EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * TanStack Query ne relance ses actualisations automatiques (refetchInterval) que si l'appli est « active ».
 * Par défaut : onglet visible. Ici : onglet visible ET quelqu'un s'en sert depuis moins de 5 minutes.
 * Au retour (mouvement, touche, onglet réaffiché), tout se remet à jour tout seul.
 */
export function installIdlePause() {
  if (typeof window === "undefined") return;
  focusManager.setEventListener((setFocused) => {
    let idle = false;
    let last = Date.now();
    let throttle = 0;
    const update = () => setFocused(document.visibilityState === "visible" && !idle);
    const activity = () => {
      last = Date.now();
      if (idle) {
        idle = false;
        update();
      }
    };
    const onEvent = () => {
      // Au plus une mise à jour par seconde : pointermove arrive très souvent.
      const now = Date.now();
      if (now - throttle < 1000 && !idle) return;
      throttle = now;
      activity();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") last = Date.now();
      idle = false;
      update();
    };
    const timer = window.setInterval(() => {
      if (!idle && document.visibilityState === "visible" && Date.now() - last > IDLE_AFTER) {
        idle = true;
        update();
      }
    }, 30_000);
    for (const e of EVENTS) window.addEventListener(e, onEvent, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      for (const e of EVENTS) window.removeEventListener(e, onEvent, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
    };
  });
}
