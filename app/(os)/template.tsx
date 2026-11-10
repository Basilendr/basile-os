"use client";
import { motion } from "motion/react";

/** Transition d'entrée discrète à chaque navigation. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div className="h-full" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", bounce: 0, visualDuration: 0.28 }}>
      {children}
    </motion.div>
  );
}
