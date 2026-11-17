export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" style={{ filter: "drop-shadow(0 0 8px var(--glow))" }}>
      <defs>
        <linearGradient id="logo-neon" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7db4ff" />
          <stop offset="1" stopColor="#2f6fed" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#logo-neon)" />
      <path d="M11 9h6.2a3.6 3.6 0 0 1 2.2 6.45A3.9 3.9 0 0 1 17.6 23H11V9Zm2.6 2.3v3.6h3.4a1.8 1.8 0 0 0 0-3.6h-3.4Zm0 5.9v3.5h3.9a1.75 1.75 0 0 0 0-3.5h-3.9Z" fill="#ffffff" />
    </svg>
  );
}
