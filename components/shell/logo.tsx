import { useId } from "react";

/** Tracé du « B » : une hampe et deux panses, au trait (repris par l'icône de l'app). */
export const LOGO_B = "M11.4 23.2V8.8h5.3a3.5 3.5 0 0 1 0 7H11.4h6.1a3.7 3.7 0 0 1 0 7.4H11.4";

/** Logo : carré arrondi en verre sombre, « B » blanc tracé et point bleu. */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2c3140" />
          <stop offset="1" stopColor="#0c0e13" />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${id}-dot`} cx="0.35" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#a9ccff" />
          <stop offset="1" stopColor="#3b82f6" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="31" height="31" rx="9.5" fill={`url(#${id}-bg)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="9.5" fill={`url(#${id}-sheen)`} stroke="#ffffff" strokeOpacity="0.16" />
      <path d={LOGO_B} fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="23.4" cy="9.3" r="2.3" fill={`url(#${id}-dot)`} />
    </svg>
  );
}
