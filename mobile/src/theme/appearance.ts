import type { AppTheme } from "../state";

export type AppColors = {
  background: string;
  card: string;
  cardAlt: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  tabInactive: string;
  chip: string;
  chipText: string;
  glowA: string;
  glowB: string;
};

const COSMIC: AppColors = {
  background: "#0B1020",
  card: "#151C33",
  cardAlt: "#121A31",
  text: "#FFFFFF",
  textMuted: "#93A3D9",
  border: "#2A365E",
  primary: "#5B8CFF",
  tabInactive: "#93A3D9",
  chip: "#121A31",
  chipText: "#C8D3FF",
  glowA: "#1D2D6B",
  glowB: "#4B2A6D",
};

const DARK: AppColors = {
  background: "#0A0D14",
  card: "#111827",
  cardAlt: "#0F172A",
  text: "#F8FAFC",
  textMuted: "#94A3B8",
  border: "#263244",
  primary: "#60A5FA",
  tabInactive: "#94A3B8",
  chip: "#162238",
  chipText: "#A5C8FF",
  glowA: "#1E3A8A",
  glowB: "#4C1D95",
};

const LIGHT: AppColors = {
  background: "#F5F7FB",
  card: "#FFFFFF",
  cardAlt: "#EEF3FF",
  text: "#0F172A",
  textMuted: "#64748B",
  border: "#D7E0F0",
  primary: "#365FD9",
  tabInactive: "#64748B",
  chip: "#EEF3FF",
  chipText: "#2848A8",
  glowA: "#BFD0FF",
  glowB: "#F6E2FF",
};

export function getAppColors(theme: AppTheme): AppColors {
  if (theme === "light") return LIGHT;
  if (theme === "dark") return DARK;
  return COSMIC;
}
