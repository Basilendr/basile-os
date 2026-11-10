import { Folder, Rocket, Code2, Palette, Briefcase, Home, GraduationCap, Heart, Lightbulb, Globe, Coffee, Music, Camera, ShoppingBag, Plane, Dumbbell, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  rocket: Rocket,
  code: Code2,
  palette: Palette,
  briefcase: Briefcase,
  home: Home,
  school: GraduationCap,
  heart: Heart,
  idea: Lightbulb,
  globe: Globe,
  coffee: Coffee,
  music: Music,
  camera: Camera,
  shop: ShoppingBag,
  travel: Plane,
  sport: Dumbbell,
};
export const PROJECT_ICONS = Object.keys(ICONS);

export function ProjectIcon({ name, className, style }: { name: string; className?: string; style?: React.CSSProperties }) {
  const I = ICONS[name] ?? Folder;
  return <I className={className} style={style} />;
}
