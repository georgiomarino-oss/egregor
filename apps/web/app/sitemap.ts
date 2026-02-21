import type { MetadataRoute } from "next";
import { siteConfig } from "./site-config";

const routes = [
  "",
  "/privacy",
  "/terms",
  "/support",
  "/subscriptions",
  "/account-deletion"
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return routes.map((route) => ({
    url: `${siteConfig.baseUrl}${route}`,
    lastModified: now,
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7
  }));
}
