"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Bell, Menu as MenuIcon, Search, LogOut, Settings, Plug, User, House, GraduationCap, Inbox, ListChecks } from "lucide-react";
import { AssistantIcon } from "./assistant-icon";
import { cn } from "@/lib/utils";
import { useUI } from "./ui-context";
import { NotificationsPopover } from "./notifications-panel";
import { LogoMark } from "./logo";
import { useStatus } from "@/hooks/use-status";
import { Kbd } from "@/components/ui/misc";
import { Menu } from "@/components/ui/menu";
import { api } from "@/lib/client/api";
import { PomodoroPill } from "@/components/school/pomodoro";

/** Rubriques principales, en pastilles au centre de la barre (ordinateur). */
const MAIN = [
  { href: "/", label: "Accueil", icon: House, match: ["/", "/today"] },
  { href: "/school", label: "École", icon: GraduationCap, match: ["/school", "/quiz", "/vocabulaire"] },
  { href: "/tasks", label: "Tâches", icon: ListChecks, match: ["/tasks", "/projects", "/calendar", "/notes"] },
  { href: "/inbox", label: "Messages", icon: Inbox, match: ["/inbox"] },
];

/** Barre supérieure flottante : logo, rubriques en pastilles, puis recherche, assistant, thème, notifications et profil. */
export function Topbar() {
  const { openPalette, setAssistantOpen, me, setMobileNavOpen, toggleSidebar } = useUI();
  const { data: status } = useStatus();
  const [notifOpen, setNotifOpen] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);
  const unread = status?.unreadNotifications ?? 0;
  const current = MAIN.find((m) => m.match.some((p) => (p === "/" ? pathname === "/" || pathname === "/today" : pathname.startsWith(p))));

  const round = "glass-btn focus-ring relative size-10 shrink-0";
  const initials = me.displayName
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <header className="relative z-40 shrink-0 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:px-3 md:pt-3">
      <div className="flex h-12 items-center gap-2">
        {/* Gauche : menu (ordinateur) et identité */}
        <button className={cn(round, "hidden md:grid")} onClick={() => (window.matchMedia("(min-width: 768px)").matches ? toggleSidebar() : setMobileNavOpen(true))} aria-label="Afficher ou réduire le menu" title="Menu">
          <MenuIcon className="size-[17px]" strokeWidth={1.8} />
        </button>
        <Link href="/" className="glass-pill focus-ring flex h-10 shrink-0 items-center gap-2.5 pr-4 pl-1.5">
          <LogoMark size={28} />
          <span className="text-[14.5px] font-semibold tracking-[-0.02em] max-[359px]:hidden">Basile OS</span>
        </Link>

        {/* Centre : rubriques */}
        <nav aria-label="Rubriques" className="glass-pill absolute left-1/2 hidden h-11 -translate-x-1/2 items-center gap-1 p-1 lg:flex">
          {MAIN.map((m) => {
            const on = current?.href === m.href;
            return (
              <Link
                key={m.href}
                href={m.href}
                aria-current={on ? "page" : undefined}
                className={cn("focus-ring relative flex h-9 items-center gap-2 rounded-full px-4 text-[13.5px] font-medium transition-colors", on ? "text-[var(--seg-active-fg)]" : "text-fg-2 hover:text-fg")}
              >
                {on && <motion.span layoutId="top-pill" className="absolute inset-0 rounded-full bg-[var(--seg-active)] shadow-[0_4px_14px_-4px_rgb(0_0_0/0.4)]" transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }} />}
                <m.icon className="relative size-4" strokeWidth={1.9} />
                <span className="relative">{m.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Droite : outils */}
        <div className="ml-auto flex min-w-0 items-center gap-2">
          <button onClick={() => openPalette()} className="glass-pill focus-ring hidden h-10 items-center gap-2 pr-2 pl-3.5 text-[13px] text-fg-3 transition-colors hover:text-fg-2 xl:flex" aria-label="Rechercher">
            <Search className="size-4" />
            <span className="w-[120px] text-left">Rechercher…</span>
            <span className="flex items-center gap-1">
              <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <button onClick={() => openPalette()} className={cn(round, "xl:hidden")} aria-label="Rechercher">
            <Search className="size-[17px]" strokeWidth={1.8} />
          </button>
          <PomodoroPill />
          <button onClick={() => setAssistantOpen(true)} className={round} aria-label="Assistant" title={`Assistant (${isMac ? "⌘" : "Ctrl"} J)`}>
            <AssistantIcon className="size-[17px]" strokeWidth={1.8} />
          </button>
          <button onClick={() => setNotifOpen((o) => !o)} className={round} aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}>
            <Bell className="size-[17px]" strokeWidth={1.8} />
            {unread > 0 && <span className="t-num absolute -top-0.5 -right-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#ff3b30] px-1 text-[10px] font-semibold text-white shadow-[0_0_0_2px_rgb(0_0_0/0.25)]">{unread > 9 ? "9+" : unread}</span>}
          </button>
          <Menu
            trigger={({ toggle }) => (
              <button onClick={toggle} className="focus-ring relative size-10 shrink-0 rounded-full transition-transform active:scale-92" aria-label="Profil">
                {me.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={me.avatarUrl} alt="" className="size-10 rounded-full object-cover ring-1 ring-white/20" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full bg-[linear-gradient(135deg,#ffb35c,#f2711c)] text-[13px] font-semibold text-white ring-1 ring-white/25">{initials}</span>
                )}
                <span className="absolute right-0 bottom-0 size-2.5 rounded-full bg-[#34c759] ring-2 ring-[var(--bg)]" />
              </button>
            )}
            items={[
              { type: "label", label: me.email },
              { label: "Profil", icon: <User />, onSelect: () => router.push("/settings") },
              { label: "Intégrations", icon: <Plug />, onSelect: () => router.push("/integrations") },
              { label: "Paramètres", icon: <Settings />, onSelect: () => router.push("/settings") },
              { type: "separator" },
              {
                label: "Déconnexion",
                icon: <LogOut />,
                danger: true,
                onSelect: async () => {
                  await api.post("/api/auth/logout");
                  window.location.href = "/login";
                },
              },
            ]}
          />
        </div>
      </div>
      <NotificationsPopover open={notifOpen} onClose={() => setNotifOpen(false)} />
    </header>
  );
}
