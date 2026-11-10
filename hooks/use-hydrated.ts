"use client";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Faux pendant le rendu serveur et l'hydratation, vrai ensuite (évite les écarts d'hydratation). */
export function useHydrated() {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
