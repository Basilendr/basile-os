import "server-only";
import { AppError } from "@/lib/errors";

/** Météo réelle via Open-Meteo (gratuit, sans clé). Cache mémoire de 15 minutes par position. */
const WMO: Record<number, { label: string; icon: string }> = {
  0: { label: "Ensoleillé", icon: "sun" },
  1: { label: "Plutôt dégagé", icon: "sun" },
  2: { label: "Partiellement nuageux", icon: "cloud-sun" },
  3: { label: "Couvert", icon: "cloud" },
  45: { label: "Brouillard", icon: "fog" },
  48: { label: "Brouillard givrant", icon: "fog" },
  51: { label: "Bruine légère", icon: "drizzle" },
  53: { label: "Bruine", icon: "drizzle" },
  55: { label: "Bruine dense", icon: "drizzle" },
  56: { label: "Bruine verglaçante", icon: "drizzle" },
  57: { label: "Bruine verglaçante", icon: "drizzle" },
  61: { label: "Pluie faible", icon: "rain" },
  63: { label: "Pluie", icon: "rain" },
  65: { label: "Forte pluie", icon: "rain" },
  66: { label: "Pluie verglaçante", icon: "rain" },
  67: { label: "Pluie verglaçante", icon: "rain" },
  71: { label: "Neige faible", icon: "snow" },
  73: { label: "Neige", icon: "snow" },
  75: { label: "Forte neige", icon: "snow" },
  77: { label: "Grains de neige", icon: "snow" },
  80: { label: "Averses", icon: "rain" },
  81: { label: "Averses", icon: "rain" },
  82: { label: "Fortes averses", icon: "rain" },
  85: { label: "Averses de neige", icon: "snow" },
  86: { label: "Averses de neige", icon: "snow" },
  95: { label: "Orage", icon: "storm" },
  96: { label: "Orage et grêle", icon: "storm" },
  99: { label: "Orage et grêle", icon: "storm" },
};
export const describeWeather = (code: number) => WMO[code] ?? { label: "Conditions inconnues", icon: "cloud" };

export type Weather = {
  place: string;
  current: { temperature: number; feelsLike: number; code: number; label: string; icon: string; isDay: boolean; wind: number; humidity: number };
  today: { min: number; max: number; rain: number; sunrise: string; sunset: string };
  days: { date: string; min: number; max: number; code: number; label: string; icon: string; rain: number }[];
  fetchedAt: string;
};

const cache = new Map<string, { at: number; data: Weather }>();

export async function getWeather(lat: number, lon: number, place: string): Promise<Weather> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return { ...hit.data, place };
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
    timezone: "auto",
    forecast_days: "5",
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${p}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) throw new AppError("integration_error", "Service météo indisponible pour le moment.");
  const d = await res.json();
  const c = d.current;
  const days = (d.daily.time as string[]).map((date, i) => ({
    date,
    min: Math.round(d.daily.temperature_2m_min[i]),
    max: Math.round(d.daily.temperature_2m_max[i]),
    code: d.daily.weather_code[i],
    ...describeWeather(d.daily.weather_code[i]),
    rain: d.daily.precipitation_probability_max?.[i] ?? 0,
  }));
  const data: Weather = {
    place,
    current: { temperature: Math.round(c.temperature_2m), feelsLike: Math.round(c.apparent_temperature), code: c.weather_code, ...describeWeather(c.weather_code), isDay: c.is_day === 1, wind: Math.round(c.wind_speed_10m), humidity: Math.round(c.relative_humidity_2m) },
    today: { min: days[0].min, max: days[0].max, rain: days[0].rain, sunrise: d.daily.sunrise[0], sunset: d.daily.sunset[0] },
    days,
    fetchedAt: new Date().toISOString(),
  };
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function geocode(name: string) {
  const p = new URLSearchParams({ name, count: "6", language: "fr", format: "json" });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!res?.ok) throw new AppError("integration_error", "Recherche de ville indisponible.");
  const d = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; country?: string; admin1?: string }[] };
  return (d.results ?? []).map((r) => ({ name: r.name, label: [r.name, r.admin1, r.country].filter(Boolean).join(", "), lat: r.latitude, lon: r.longitude }));
}

/** Position par défaut déduite du fuseau horaire quand aucune ville n'est choisie (affichée comme telle). */
const TZ_CITIES: Record<string, { name: string; lat: number; lon: number }> = {
  "Europe/Paris": { name: "Paris", lat: 48.8566, lon: 2.3522 },
  "Europe/Brussels": { name: "Bruxelles", lat: 50.8503, lon: 4.3517 },
  "Europe/Zurich": { name: "Zurich", lat: 47.3769, lon: 8.5417 },
  "America/Montreal": { name: "Montréal", lat: 45.5017, lon: -73.5673 },
  "Europe/London": { name: "Londres", lat: 51.5072, lon: -0.1276 },
};
export const defaultPlace = (tz: string) => TZ_CITIES[tz] ?? TZ_CITIES["Europe/Paris"];
