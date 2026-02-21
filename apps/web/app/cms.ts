import { defaultSiteContent, type SiteContent } from "./site-content";

type JsonMap = Record<string, unknown>;

type CmsSettings = {
  projectId: string;
  dataset: string;
  apiVersion: string;
  token?: string;
};

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isObject(value: unknown): value is JsonMap {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildCmsSettings(): CmsSettings | null {
  const projectId = process.env.SANITY_PROJECT_ID;
  const dataset = process.env.SANITY_DATASET;

  if (!projectId || !dataset) {
    return null;
  }

  return {
    projectId,
    dataset,
    apiVersion: process.env.SANITY_API_VERSION ?? "v2025-02-19",
    token: process.env.SANITY_API_READ_TOKEN
  };
}

async function fetchSanityContent(settings: CmsSettings): Promise<unknown> {
  const query = `*[_type == "siteContent" && slug.current == "website"][0]{
    hero,
    mission,
    meaning,
    experience,
    trust,
    finalCta,
    support
  }`;

  const endpoint = `https://${settings.projectId}.api.sanity.io/${settings.apiVersion}/data/query/${settings.dataset}?query=${encodeURIComponent(query)}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (settings.token) {
    headers.Authorization = `Bearer ${settings.token}`;
  }

  const response = await fetch(endpoint, {
    headers,
    next: { revalidate: 300 }
  });

  if (!response.ok) {
    throw new Error(`Sanity request failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
}

function mergeContent(cmsContent: unknown): SiteContent {
  if (!isObject(cmsContent)) {
    return defaultSiteContent;
  }

  const hero = isObject(cmsContent.hero) ? cmsContent.hero : {};
  const mission = isObject(cmsContent.mission) ? cmsContent.mission : {};
  const meaning = isObject(cmsContent.meaning) ? cmsContent.meaning : {};
  const experience = isObject(cmsContent.experience) ? cmsContent.experience : {};
  const trust = isObject(cmsContent.trust) ? cmsContent.trust : {};
  const finalCta = isObject(cmsContent.finalCta) ? cmsContent.finalCta : {};
  const support = isObject(cmsContent.support) ? cmsContent.support : {};

  return {
    hero: {
      ...defaultSiteContent.hero,
      ...hero,
      beliefBullets: isStringArray(hero.beliefBullets)
        ? hero.beliefBullets
        : defaultSiteContent.hero.beliefBullets,
      metrics:
        Array.isArray(hero.metrics) &&
        hero.metrics.every(
          (metric) =>
            isObject(metric) &&
            typeof metric.id === "string" &&
            typeof metric.label === "string"
        )
          ? hero.metrics
          : defaultSiteContent.hero.metrics
    },
    mission: {
      ...defaultSiteContent.mission,
      ...mission,
      pillars:
        Array.isArray(mission.pillars) &&
        mission.pillars.every(
          (pillar) =>
            isObject(pillar) &&
            typeof pillar.title === "string" &&
            typeof pillar.description === "string"
        )
          ? mission.pillars
          : defaultSiteContent.mission.pillars
    },
    meaning: {
      ...defaultSiteContent.meaning,
      ...meaning
    },
    experience: {
      ...defaultSiteContent.experience,
      ...experience,
      steps:
        Array.isArray(experience.steps) &&
        experience.steps.every(
          (step) =>
            isObject(step) &&
            typeof step.step === "string" &&
            typeof step.description === "string"
        )
          ? experience.steps
          : defaultSiteContent.experience.steps
    },
    trust: {
      ...defaultSiteContent.trust,
      ...trust,
      cards:
        Array.isArray(trust.cards) &&
        trust.cards.every(
          (card) =>
            isObject(card) &&
            typeof card.title === "string" &&
            typeof card.body === "string"
        )
          ? trust.cards
          : defaultSiteContent.trust.cards
    },
    finalCta: {
      ...defaultSiteContent.finalCta,
      ...finalCta
    },
    support: {
      ...defaultSiteContent.support,
      ...support,
      topics: isStringArray(support.topics)
        ? support.topics
        : defaultSiteContent.support.topics
    }
  };
}

export async function getSiteContent(): Promise<SiteContent> {
  const settings = buildCmsSettings();

  if (!settings) {
    return defaultSiteContent;
  }

  try {
    const cmsContent = await fetchSanityContent(settings);
    return mergeContent(cmsContent);
  } catch (error) {
    console.error("Failed to load CMS content. Using defaults.", error);
    return defaultSiteContent;
  }
}
