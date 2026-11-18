import { createLucideIcon } from "lucide-react";

/** Icône de l'assistant, propre à Basile OS : une bulle de dialogue et le point bleu du logo (pas d'étincelles « IA »). */
export const AssistantIcon = createLucideIcon("BasileAssistant", [
  ["path", { d: "M20.5 11.5a8.5 8.5 0 0 1-12.6 7.45L3.5 20l1.1-4.2A8.5 8.5 0 1 1 20.5 11.5Z", key: "bubble" }],
  ["circle", { cx: "12", cy: "11.5", r: "2.2", fill: "currentColor", stroke: "none", key: "dot" }],
]);
