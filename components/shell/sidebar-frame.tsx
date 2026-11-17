"use client";
import { motion } from "motion/react";
import { SidebarContent } from "./sidebar";
import { useUI } from "./ui-context";
import { cn } from "@/lib/utils";

const WIDE = 252;
const RAIL = 64;

/** Menu flottant : dock d'icônes en pastille (par défaut) ou panneau large avec les dossiers. */
export function Sidebar() {
  const { sidebarCollapsed: collapsed } = useUI();
  return (
    <motion.aside
      className={cn(
        "hidden shrink-0 border border-line bg-card shadow-[var(--shadow-md)] md:block",
        collapsed ? "self-center rounded-[32px]" : "overflow-hidden rounded-[24px]",
      )}
      initial={false}
      animate={{ width: collapsed ? RAIL : WIDE }}
      transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
    >
      <div className={collapsed ? "" : "h-full"} style={{ width: collapsed ? RAIL - 2 : WIDE }}>
        <SidebarContent collapsed={collapsed} />
      </div>
    </motion.aside>
  );
}
