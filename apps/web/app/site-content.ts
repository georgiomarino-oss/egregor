export type SiteMetric = {
  id: string;
  label: string;
};

export type SitePillar = {
  title: string;
  description: string;
};

export type SiteJourneyStep = {
  step: string;
  description: string;
};

export type SiteTrustCard = {
  title: string;
  body: string;
};

export type SiteContent = {
  hero: {
    kicker: string;
    title: string;
    lead: string;
    body: string;
    beliefTitle: string;
    beliefBullets: string[];
    metrics: SiteMetric[];
  };
  mission: {
    title: string;
    paragraphOne: string;
    paragraphTwo: string;
    pillars: SitePillar[];
  };
  meaning: {
    title: string;
    meaningTitle: string;
    meaningBody: string;
    fitTitle: string;
    fitBody: string;
  };
  experience: {
    title: string;
    steps: SiteJourneyStep[];
  };
  trust: {
    title: string;
    intro: string;
    cards: SiteTrustCard[];
  };
  finalCta: {
    title: string;
    body: string;
  };
  support: {
    title: string;
    intro: string;
    formTitle: string;
    formDescription: string;
    topics: string[];
  };
};

export const defaultSiteContent: SiteContent = {
  hero: {
    kicker: "Egregor.world",
    title: "When intention is shared, meaningful change accelerates.",
    lead: "A shared space where intention becomes action and action becomes meaningful change.",
    body: "Egregor is built for people who believe a better world begins with better inner habits: thoughtful attention, consistent reflection, and action rooted in values.",
    beliefTitle:
      "Collectively, we have the power to shape culture through intention.",
    beliefBullets: [
      "Intentional people build intentional communities.",
      "Intentional communities build resilient futures.",
      "Egregor exists to make that process practical daily."
    ],
    metrics: [
      { id: "01", label: "Human-centered design" },
      { id: "02", label: "Reflection plus action loop" },
      { id: "03", label: "Trust-led platform standards" }
    ]
  },
  mission: {
    title: "Build a calmer, clearer, more constructive digital experience.",
    paragraphOne:
      "Most digital products compete for attention. Egregor is built to restore attention. We want users to leave with more clarity and more agency, not more distraction.",
    paragraphTwo:
      "Our long-term goal is simple: support people in creating habits that improve personal wellbeing and create positive ripple effects in homes, teams, and communities.",
    pillars: [
      {
        title: "Intention First",
        description:
          "A deliberate pause helps people move from reaction to purpose, then from purpose to action."
      },
      {
        title: "Reflection That Grounds",
        description:
          "Journaling and guided moments are designed to reduce noise and sharpen personal clarity."
      },
      {
        title: "Collective Momentum",
        description:
          "When people align around constructive intent, small choices compound into meaningful change."
      }
    ]
  },
  meaning: {
    title: "Why we chose the word \"Egregor\"",
    meaningTitle: "Meaning behind the word",
    meaningBody:
      "\"Egregor\" is often used to describe a collective thought form: the shared energy and direction that emerges when people align around a common intention.",
    fitTitle: "Why it fits this app",
    fitBody:
      "We chose the name because it captures our thesis exactly: individual mindset matters, but shared intention changes what is possible at scale."
  },
  experience: {
    title: "A simple flow designed for daily momentum.",
    steps: [
      {
        step: "Set an intention",
        description:
          "Start with what matters most to you, not what the feed tells you to care about."
      },
      {
        step: "Capture your reflection",
        description:
          "Track thoughts and progress so growth becomes visible, personal, and sustainable."
      },
      {
        step: "Take one real action",
        description:
          "Translate insight into something practical that improves your day or helps someone else."
      },
      {
        step: "Contribute to the whole",
        description:
          "The app reinforces a core belief: individually intentional people create a healthier collective."
      }
    ]
  },
  trust: {
    title: "Built to be transparent, compliant, and user-respectful.",
    intro:
      "Legal and policy pages are part of the experience, not hidden away. You can review how data is handled, how subscriptions work, and how account deletion is processed.",
    cards: [
      {
        title: "Privacy by design",
        body: "Clear explanations of what data we collect and why."
      },
      {
        title: "Fair subscription terms",
        body: "Transparent billing, renewal, and cancellation details."
      },
      {
        title: "Practical support",
        body: "Fast ways to contact us and resolve account issues."
      },
      {
        title: "User control",
        body: "A documented account deletion path inside the app and on web."
      }
    ]
  },
  finalCta: {
    title: "Let's make intention practical.",
    body: "Questions, partnerships, or support needs? Reach out and the Egregor team will respond."
  },
  support: {
    title: "Support",
    intro:
      "Need help with your account, subscriptions, or technical issues? Send us a message and we will get back to you.",
    formTitle: "Send us a message",
    formDescription:
      "Use this form for support, billing, legal, and partnership questions.",
    topics: [
      "Account access",
      "Subscriptions and billing",
      "Bug report",
      "Privacy and legal",
      "Partnership or media",
      "Other"
    ]
  }
};
