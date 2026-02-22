import type { AppTheme } from "../../state";

type MapboxVariant = "global" | "groupMini";

type BuildMapboxStaticMapUrlArgs = {
  theme: AppTheme;
  variant: MapboxVariant;
  width: number;
  height: number;
};

function getMapboxPublicToken() {
  const preferred = String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "").trim();
  if (preferred) return preferred;
  return String(process.env.EXPO_PUBLIC_MAPBOX_PUBLIC_TOKEN ?? "").trim();
}

function getStyleId(theme: AppTheme) {
  if (theme === "light") return "light-v11";
  return "dark-v11";
}

function getViewport(variant: MapboxVariant) {
  if (variant === "groupMini") {
    // Slightly zoomed-out world framing for compact preview cards.
    return { lon: -18, lat: 20, zoom: 0.9, bearing: 0, pitch: 0 };
  }
  // Main heatmap view has a slightly closer initial framing.
  return { lon: -12, lat: 19, zoom: 1.12, bearing: 0, pitch: 0 };
}

function clampDimension(value: number, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(100, Math.min(1280, Math.round(n)));
}

export function buildMapboxStaticMapUrl(args: BuildMapboxStaticMapUrlArgs) {
  const token = getMapboxPublicToken();
  if (!token) return "";

  const styleId = getStyleId(args.theme);
  const viewport = getViewport(args.variant);
  const width = clampDimension(args.width, 1200);
  const height = clampDimension(args.height, 700);
  const center = `${viewport.lon},${viewport.lat},${viewport.zoom},${viewport.bearing},${viewport.pitch}`;

  return `https://api.mapbox.com/styles/v1/mapbox/${styleId}/static/${center}/${width}x${height}?access_token=${encodeURIComponent(
    token
  )}&logo=false&attribution=false`;
}

export function hasMapboxStaticToken() {
  return !!getMapboxPublicToken();
}

