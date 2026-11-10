import { Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudMoon, CloudRain, CloudSnow, CloudSun, Droplets, Moon, Snowflake, Sun, Zap, type LucideProps } from "lucide-react";

/** Icône correspondant au code renvoyé par /api/weather (variante nuit si besoin). */
export function WeatherIcon({ icon, night, ...p }: { icon: string; night?: boolean } & LucideProps) {
  const I = { sun: night ? Moon : Sun, "cloud-sun": night ? CloudMoon : CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning }[icon] ?? Cloud;
  return <I {...p} />;
}

export type WeatherData = {
  place: string;
  isDefaultPlace: boolean;
  current: { temperature: number; feelsLike: number; code: number; label: string; icon: string; isDay: boolean; wind: number; humidity: number };
  today: { min: number; max: number; rain: number; sunrise: string; sunset: string };
  days: { date: string; min: number; max: number; code: number; label: string; icon: string; rain: number }[];
  fetchedAt: string;
};

/** Illustration colorée de la météo (soleil, lune, nuages, pluie, neige, orage) superposée en calques. */
export function WeatherArt({ icon, night, size = 56 }: { icon: string; night?: boolean; size?: number }) {
  const s = size;
  const sun = night ? (
    <Moon className="absolute" style={{ width: s * 0.62, height: s * 0.62, top: 0, right: 0, color: "#c9cfff", fill: "#e9ebff" }} strokeWidth={1.4} />
  ) : (
    <Sun className="absolute" style={{ width: s * 0.66, height: s * 0.66, top: 0, right: 0, color: "#f59e0b", fill: "#fcd34d" }} strokeWidth={1.6} />
  );
  const cloud = (scale: number, extra?: React.CSSProperties) => (
    <Cloud className="absolute drop-shadow-sm" style={{ width: s * scale, height: s * scale, color: "#94a3b8", fill: "#ffffff", ...extra }} strokeWidth={1.3} />
  );
  return (
    <span className="relative inline-block shrink-0" style={{ width: s, height: s }} aria-hidden>
      {icon === "sun" && !night && <Sun className="absolute inset-0 m-auto" style={{ width: s * 0.86, height: s * 0.86, color: "#f59e0b", fill: "#fcd34d" }} strokeWidth={1.5} />}
      {icon === "sun" && night && <Moon className="absolute inset-0 m-auto" style={{ width: s * 0.8, height: s * 0.8, color: "#c9cfff", fill: "#eef0ff" }} strokeWidth={1.4} />}
      {icon === "cloud-sun" && (
        <>
          {sun}
          {cloud(0.78, { bottom: 0, left: 0 })}
        </>
      )}
      {(icon === "cloud" || icon === "fog") && (
        <>
          {cloud(0.62, { top: s * 0.06, right: 0, opacity: 0.8 })}
          {cloud(0.8, { bottom: 0, left: 0 })}
        </>
      )}
      {(icon === "rain" || icon === "drizzle" || icon === "storm" || icon === "snow") && (
        <>
          {cloud(0.82, { top: 0, left: s * 0.09 })}
          {icon === "storm" ? (
            <Zap className="absolute" style={{ width: s * 0.36, height: s * 0.36, bottom: 0, left: s * 0.36, color: "#f59e0b", fill: "#fcd34d" }} strokeWidth={1.5} />
          ) : icon === "snow" ? (
            <Snowflake className="absolute" style={{ width: s * 0.3, height: s * 0.3, bottom: 0, left: s * 0.38, color: "#7dd3fc" }} strokeWidth={2} />
          ) : (
            <Droplets className="absolute" style={{ width: s * 0.32, height: s * 0.32, bottom: 0, left: s * 0.36, color: "#3b82f6", fill: "#93c5fd" }} strokeWidth={1.6} />
          )}
        </>
      )}
    </span>
  );
}
