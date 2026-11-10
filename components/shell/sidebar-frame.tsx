"use client";
import { motion } from "motion/react";
import { SidebarContent } from "./sidebar";
import { useUI } from "./ui-context";

const WIDE = 252;
const RAIL = 72;

/** Barre latérale flottante (panneau arrondi) : large avec dossiers, ou rail d'icônes. */
export function Sidebar() {
  const { sidebarCollapsed: collapsed } = useUI();
  return (
    <motion.aside
      className="hidden shrink-0 overflow-hidden rounded-[20px] border border-line bg-card shadow-[var(--shadow-sm)] md:block"
      initial={false}
      animate={{ width: collapsed ? RAIL : WIDE }}
      transition={{ type: "spring", bounce: 0, visualDuration: 0.3 }}
    >
      <div className="h-full" style={{ width: collapsed ? RAIL : WIDE }}>
        <SidebarContent collapsed={collapsed} />
      </div>
    </motion.aside>
  );
}
