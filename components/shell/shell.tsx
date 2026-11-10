"use client";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { House, Sparkles, Inbox, Sun, LayoutGrid, Share, X } from "lucide-react";
import { isIos, isStandalone, registerSw } from "@/lib/client/push";
import { Sidebar } from "./sidebar-frame";
import { SidebarContent } from "./sidebar";
import { Topbar } from "./topbar";
import { CommandPalette } from "./command-palette";
import { UIProvider, useUI, type Me } from "./ui-context";
import { NAV, isActive } from "./nav";
import { LogoMark } from "./logo";
import { CreateDialogs } from "@/components/create/create-dialogs";
import { AssistantDrawer } from "@/components/assistant/drawer";
import { cn } from "@/lib/utils";
import { SchoolAutoSync } from "@/components/settings/school-connect";
import { PomodoroProvider } from "@/components/school/pomodoro";

export function Shell({ me, children }: { me: Me; children: ReactNode }) {
  return (
    <UIProvider me={me}>
      <PomodoroProvider>
        <ShellInner>{children}</ShellInner>
      </PomodoroProvider>
      <SchoolAutoSync />
    </UIProvider>
  );
}

const G_SHORTCUTS: Record<string, string> = Object.fromEntries(
  NAV.filter((n) => n.shortcut?.startsWith("G ")).map((n) => [n.shortcut!.slice(2).toLowerCase(), n.href]),
);
G_SHORTCUTS[","] = "/settings";
G_SHORTCUTS["e"] = "/school";

function ShellInner({ children }: { children: ReactNode }) {
  const { openPalette, paletteOpen, setAssistantOpen, assistantOpen, mobileNavOpen, setMobileNavOpen, openCreate } = useUI();
  const router = useRouter();
  const pathname = usePathname();
  const gPressed = useRef(0);

  useEffect(() => setMobileNavOpen(false), [pathname, setMobileNavOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        paletteOpen ? null : openPalette();
        return;
      }
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAssistantOpen(!assistantOpen);
        return;
      }
      if (typing || mod || e.altKey || document.querySelector('[role="dialog"]')) return;
      if (e.key === "/") {
        e.preventDefault();
        openPalette();
      } else if (e.key.toLowerCase() === "g") {
        gPressed.current = Date.now();
      } else if (Date.now() - gPressed.current < 900 && G_SHORTCUTS[e.key.toLowerCase()]) {
        gPressed.current = 0;
        router.push(G_SHORTCUTS[e.key.toLowerCase()]);
      } else if (e.key.toLowerCase() === "c") {
        openCreate("task");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, paletteOpen, setAssistantOpen, assistantOpen, router, openCreate]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <Topbar />
      <div className="flex min-h-0 flex-1 gap-3 p-2 md:p-3">
        <Suspense>
          <Sidebar />
        </Suspense>

        <AnimatePresence>
          {mobileNavOpen && (
            <div className="fixed inset-0 z-[70] md:hidden">
              <motion.div className="absolute inset-0 bg-[var(--scrim)]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileNavOpen(false)} />
              <motion.aside
                className="absolute inset-y-0 left-0 flex w-[284px] max-w-[85vw] flex-col border-r border-line bg-card pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
                initial={{ x: "-100%" }}
                animate={{ x: 0 }}
                exit={{ x: "-100%" }}
                transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
                drag="x"
                dragConstraints={{ left: -300, right: 0 }}
                dragElastic={{ left: 0.2, right: 0 }}
                onDragEnd={(_, info) => {
                  if (info.velocity.x < -300 || info.offset.x < -100) setMobileNavOpen(false);
                }}
              >
                <div className="flex h-14 items-center gap-2.5 border-b border-line-soft px-4">
                  <LogoMark size={26} />
                  <span className="text-[15px] font-semibold tracking-[-0.02em]">Basile OS</span>
                </div>
                <div className="min-h-0 flex-1">
                  <Suspense>
                <SidebarContent collapsed={false} onNavigate={() => setMobileNavOpen(false)} />
              </Suspense>
                </div>
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        <main id="main" className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain rounded-[20px] pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-0">
          {children}
        </main>
      </div>
      <MobileTabBar />

      <CommandPalette />
      <CreateDialogs />
      <AssistantDrawer />
    </div>
  );
}

function MobileTabBar() {
  const pathname = usePathname();
  const { setMobileNavOpen } = useUI();
  const tabs = [
    { href: "/", label: "Accueil", icon: House },
    { href: "/today", label: "Aujourd'hui", icon: Sun },
    { href: "/assistant", label: "Assistant", icon: Sparkles },
    { href: "/inbox", label: "Messages", icon: Inbox },
  ];
  return (
    <>
      <InstallHint />
      <nav className="glass fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-line-soft pb-[env(safe-area-inset-bottom)] md:hidden" aria-label="Navigation mobile">
        {tabs.map((t) => {
          const active = isActive(pathname, t.href);
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium transition-transform active:scale-90", active ? "text-accent" : "text-fg-3")}
            >
              <t.icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} />
              {t.label}
            </Link>
          );
        })}
        <button onClick={() => setMobileNavOpen(true)} className="flex h-[58px] flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium text-fg-3 transition-transform active:scale-90">
          <LayoutGrid className="size-[22px]" strokeWidth={1.8} />
          Plus
        </button>
      </nav>
    </>
  );
}

/** iPhone dans Safari : invitation (masquable) à installer l'app sur l'écran d'accueil. */
function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    registerSw();
    try {
      if (isIos() && !isStandalone() && localStorage.getItem("bos.installHint") !== "0") setShow(true);
    } catch {}
  }, []);
  if (!show) return null;
  const hide = () => {
    setShow(false);
    try {
      localStorage.setItem("bos.installHint", "0");
    } catch {}
  };
  return (
    <div className="fixed inset-x-2 bottom-[calc(66px+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-[16px] border border-line bg-card px-3.5 py-2.5 shadow-[var(--shadow-lg)] md:hidden">
      <Share className="size-5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug">
        Installe l'app : touche <b>Partager</b> puis <b>Sur l'écran d'accueil</b>.
      </p>
      <button onClick={hide} className="grid size-8 shrink-0 place-items-center rounded-full text-fg-3 active:bg-raised" aria-label="Masquer">
        <X className="size-4" />
      </button>
    </div>
  );
}
