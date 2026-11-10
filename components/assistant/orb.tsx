"use client";
import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Orbe de l'assistant : un anneau lumineux (dégradé turquoise → blanc) qui tourne lentement,
 * plus vite quand l'IA travaille ; figé si l'utilisateur réduit les animations.
 */
export function Orb({ size = 96, active, className }: { size?: number; active?: boolean; className?: string }) {
  const id = useId();
  const stroke = Math.max(2, size * 0.075);
  const r = size / 2 - stroke;
  return (
    <div className={cn("relative isolate", className)} style={{ width: size, height: size }} aria-hidden>
      <div className="absolute inset-[-35%] -z-10 rounded-full opacity-70 blur-2xl motion-safe:animate-[orb-breathe_7s_ease-in-out_infinite]" style={{ background: "radial-gradient(circle, color-mix(in srgb, #2dd4bf 30%, transparent), transparent 62%)" }} />
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={cn("absolute inset-0 motion-safe:animate-[orb-spin_9s_linear_infinite]", active && "motion-safe:animate-[orb-spin_1.6s_linear_infinite]")}>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2dd4bf" />
            <stop offset="0.45" stopColor="#5eead4" />
            <stop offset="0.75" stopColor="var(--orb-tail, #e5e7eb)" />
            <stop offset="1" stopColor="var(--orb-tail, #e5e7eb)" stopOpacity="0.15" />
          </linearGradient>
          <filter id={`${id}-b`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation={size * 0.035} />
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id}-g)`} strokeWidth={stroke * 1.6} filter={`url(#${id}-b)`} opacity="0.7" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id}-g)`} strokeWidth={stroke} strokeLinecap="round" />
      </svg>
    </div>
  );
}
