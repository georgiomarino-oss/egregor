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

const COSMIC_HIGH_CONTRAST: AppColors = {
  ...COSMIC,
  background: "#050810",
  card: "#0D1730",
  cardAlt: "#0A1328",
  text: "#FFFFFF",
  textMuted: "#D4E2FF",
  border: "#6E8DFF",
  primary: "#86A6FF",
  tabInactive: "#D4E2FF",
  chip: "#0A1328",
  chipText: "#FFFFFF",
  glowA: "#2A4CB4",
  glowB: "#7438A6",
};

const DARK_HIGH_CONTRAST: AppColors = {
  ...DARK,
  background: "#000000",
  card: "#0B1220",
  cardAlt: "#060E1A",
  text: "#FFFFFF",
  textMuted: "#D6E2FF",
  border: "#7DA3FF",
  primary: "#8CB4FF",
  tabInactive: "#D6E2FF",
  chip: "#091224",
  chipText: "#FFFFFF",
  glowA: "#204EA6",
  glowB: "#6D28D9",
};

const LIGHT_HIGH_CONTRAST: AppColors = {
  ...LIGHT,
  background: "#FFFFFF",
  card: "#FFFFFF",
  cardAlt: "#F2F6FF",
  text: "#0A1020",
  textMuted: "#22314F",
  border: "#2C4FA8",
  primary: "#1E45B7",
  tabInactive: "#22314F",
  chip: "#E8EFFF",
  chipText: "#0A1020",
  glowA: "#C4D8FF",
  glowB: "#F0DFFF",
};

export function getAppColors(theme: AppTheme, highContrast = false): AppColors {
  if (highContrast) {
    if (theme === "light") return LIGHT_HIGH_CONTRAST;
    if (theme === "dark") return DARK_HIGH_CONTRAST;
    return COSMIC_HIGH_CONTRAST;
  }
  if (theme === "light") return LIGHT;
  if (theme === "dark") return DARK;
  return COSMIC;
}
