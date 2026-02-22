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

export type ScreenContext = "home" | "group" | "solo" | "profile";
export type DayPeriod = "day" | "evening";
export type ScreenColors = AppColors & {
  context: ScreenContext;
  dayPeriod: DayPeriod;
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

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHexColor(hex: string) {
  const raw = String(hex ?? "").trim();
  const normalized = raw.startsWith("#") ? raw.slice(1) : raw;
  if (normalized.length !== 6) return null;
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return { r, g, b };
}

function toHexColor(rgb: { r: number; g: number; b: number }) {
  const toHex = (v: number) => clampChannel(v).toString(16).padStart(2, "0");
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`.toUpperCase();
}

function mixHex(base: string, mix: string, ratio: number) {
  const a = parseHexColor(base);
  const b = parseHexColor(mix);
  if (!a || !b) return base;
  const t = Math.max(0, Math.min(1, ratio));
  return toHexColor({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

function shiftForPeriod(base: string, period: DayPeriod) {
  return period === "day" ? mixHex(base, "#FFFFFF", 0.06) : mixHex(base, "#000000", 0.12);
}

function getContextHue(context: ScreenContext) {
  if (context === "home") return "#18B8A2";
  if (context === "group") return "#4F7BFF";
  if (context === "solo") return "#8B63FF";
  return "#F59E0B";
}

export function getDayPeriod(date: Date = new Date()): DayPeriod {
  const hour = date.getHours();
  return hour >= 6 && hour < 18 ? "day" : "evening";
}

export function getScreenColors(
  theme: AppTheme,
  highContrast = false,
  context: ScreenContext = "home",
  date: Date = new Date()
): ScreenColors {
  const base = getAppColors(theme, highContrast);
  const dayPeriod = getDayPeriod(date);
  const hue = getContextHue(context);

  const blendStrength = highContrast ? 0.16 : 0.24;
  const glowBlendStrength = highContrast ? 0.22 : 0.4;

  return {
    ...base,
    context,
    dayPeriod,
    background: mixHex(shiftForPeriod(base.background, dayPeriod), hue, blendStrength * 0.38),
    card: mixHex(shiftForPeriod(base.card, dayPeriod), hue, blendStrength * 0.42),
    cardAlt: mixHex(shiftForPeriod(base.cardAlt, dayPeriod), hue, blendStrength * 0.5),
    border: mixHex(base.border, hue, blendStrength * 0.64),
    primary: mixHex(base.primary, hue, 0.58),
    chip: mixHex(base.chip, hue, blendStrength * 0.56),
    chipText: mixHex(base.chipText, hue, 0.18),
    glowA: mixHex(base.glowA, hue, glowBlendStrength),
    glowB: mixHex(base.glowB, hue, glowBlendStrength * 0.8),
  };
}
