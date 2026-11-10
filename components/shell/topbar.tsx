"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Menu as MenuIcon, Search, LogOut, Settings, Plug, User, Sun, Moon, Sparkles, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUI } from "./ui-context";
import { NotificationsPopover } from "./notifications-panel";
import { LogoMark } from "./logo";
import { useStatus } from "@/hooks/use-status";
import { Avatar, Kbd } from "@/components/ui/misc";
import { Menu } from "@/components/ui/menu";
import { api } from "@/lib/client/api";
import { PomodoroPill } from "@/components/school/pomodoro";

/** Barre supérieure pleine largeur : identité, recherche, thème, notifications, profil. */
export function Topbar() {
  const { openPalette, setAssistantOpen, me, setMobileNavOpen, toggleSidebar } = useUI();
  const { data: status } = useStatus();
  const [notifOpen, setNotifOpen] = useState(false);
  const [isMac, setIsMac] = useState(true);
  const [dark, setDark] = useState(false);
  const router = useRouter();
  useEffect(() => {
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    setDark(document.documentElement.dataset.theme === "dark");
  }, []);
  const unread = status?.unreadNotifications ?? 0;

  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    setDark(!dark);
    api.patch("/api/preferences", { theme: next }).catch(() => null);
  };

  const circle = "focus-ring relative grid size-9 place-items-center rounded-full border border-line bg-bg/60 text-fg-2 transition-colors hover:bg-raised hover:text-fg";
  return (
    <header className="z-40 shrink-0 px-2 pt-2 md:px-3 md:pt-3">
      <div className="flex h-14 items-center gap-2 rounded-[20px] border border-line bg-card px-2.5 shadow-[var(--shadow-sm)]">
      <button
        className="focus-ring grid size-9 place-items-center rounded-[11px] border border-line bg-bg/60 text-fg-2 transition-colors hover:bg-raised hover:text-fg"
        onClick={() => (window.matchMedia("(min-width: 768px)").matches ? toggleSidebar() : setMobileNavOpen(true))}
        aria-label="Menu"
      >
        <MenuIcon className="size-[17px]" strokeWidth={1.75} />
      </button>
      <Link href="/" className="focus-ring flex shrink-0 items-center gap-2.5 rounded-[8px] pl-1">
        <LogoMark size={26} />
        <span className="hidden text-[15px] font-semibold tracking-[-0.02em] sm:inline">Basile OS</span>
      </Link>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <button
          onClick={() => openPalette()}
          className="focus-ring flex h-9 min-w-0 items-center gap-2 rounded-full border border-line bg-bg/60 px-3.5 text-left text-[13px] text-fg-3 transition-colors hover:border-fg-3/40 hover:text-fg-2 md:w-[260px]"
          aria-label="Rechercher"
        >
          <Search className="size-4 shrink-0" />
          <span className="hidden truncate sm:inline">Rechercher…</span>
          <span className="ml-auto hidden items-center gap-1 md:flex">
            <Kbd>{isMac ? "⌘" : "Ctrl"}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <PomodoroPill />
        <button onClick={() => setAssistantOpen(true)} className={circle} aria-label="Assistant" title={`Assistant (${isMac ? "⌘" : "Ctrl"} J)`}>
          <Sparkles className="size-[16px]" strokeWidth={1.75} />
        </button>
        <button onClick={toggleTheme} className={cn(circle, "hidden sm:grid")} aria-label={dark ? "Thème clair" : "Thème sombre"} title={dark ? "Thème clair" : "Thème sombre"}>
          {dark ? <Sun className="size-[16px]" strokeWidth={1.75} /> : <Moon className="size-[16px]" strokeWidth={1.75} />}
        </button>
        <button onClick={() => setNotifOpen((o) => !o)} className={circle} aria-label={`Notifications${unread ? ` (${unread} non lues)` : ""}`}>
          <Bell className="size-[16px]" strokeWidth={1.75} />
          {unread > 0 && <span className="t-num absolute -top-1 -right-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white ring-2 ring-card">{unread > 9 ? "9+" : unread}</span>}
        </button>
        <Menu
          trigger={({ toggle }) => (
            <button onClick={toggle} className="focus-ring flex h-9 items-center gap-2 rounded-full border border-line bg-bg/60 pr-2.5 pl-1 transition-colors hover:bg-raised" aria-label="Profil">
              <Avatar name={me.displayName} src={me.avatarUrl} size={26} />
              <span className="hidden text-[13px] font-medium sm:inline">{me.displayName.split(" ")[0]}</span>
              <ChevronDown className="hidden size-3.5 text-fg-3 sm:block" />
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
