"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type CreateKind = "task" | "event" | "note" | "project" | "email" | "automation" | "file" | "contact" | "transaction";

export type Me = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  timezone: string;
  prefs: { sidebarCollapsed: boolean; theme: string; accent: string; density: string; aiProvider: string; aiModel: string; memoryEnabled: boolean };
};

type UI = {
  me: Me;
  paletteOpen: boolean;
  paletteQuery: string;
  openPalette: (query?: string) => void;
  closePalette: () => void;
  assistantOpen: boolean;
  setAssistantOpen: (v: boolean) => void;
  assistantSeed: string | null;
  askAssistant: (prompt: string) => void;
  create: { kind: CreateKind; defaults?: Record<string, unknown> } | null;
  openCreate: (kind: CreateKind, defaults?: Record<string, unknown>) => void;
  closeCreate: () => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
};

const Ctx = createContext<UI | null>(null);

export function useUI() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUI hors du Shell");
  return v;
}

export function UIProvider({ me, children }: { me: Me; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantSeed, setAssistantSeed] = useState<string | null>(null);
  const [create, setCreate] = useState<UI["create"]>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(me.prefs.sidebarCollapsed);
  useEffect(() => {
    try {
      const v = localStorage.getItem("bos.sidebar");
      if (v !== null) setSidebarCollapsed(v === "1");
    } catch {}
  }, []);
  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("bos.sidebar", next ? "1" : "0");
      } catch {}
      fetch("/api/preferences", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sidebarCollapsed: next }) }).catch(() => null);
      return next;
    });
  }, []);

  const openPalette = useCallback((q = "") => {
    setPaletteQuery(q);
    setPaletteOpen(true);
  }, []);
  const askAssistant = useCallback((p: string) => {
    setAssistantSeed(p);
    setAssistantOpen(true);
  }, []);

  const value = useMemo<UI>(
    () => ({
      me,
      paletteOpen,
      paletteQuery,
      openPalette,
      closePalette: () => setPaletteOpen(false),
      assistantOpen,
      setAssistantOpen: (v) => {
        setAssistantOpen(v);
        if (!v) setAssistantSeed(null);
      },
      assistantSeed,
      askAssistant,
      create,
      openCreate: (kind, defaults) => setCreate({ kind, defaults }),
      closeCreate: () => setCreate(null),
      mobileNavOpen,
      setMobileNavOpen,
      sidebarCollapsed,
      toggleSidebar,
    }),
    [me, paletteOpen, paletteQuery, openPalette, assistantOpen, assistantSeed, askAssistant, create, mobileNavOpen, sidebarCollapsed, toggleSidebar],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
