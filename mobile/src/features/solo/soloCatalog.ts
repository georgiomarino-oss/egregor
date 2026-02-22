export type SoloPresetCategory = "Relationships" | "Wellbeing" | "Abundance" | "World";

export type SoloPresetDuration = 3 | 5 | 10;

export type SoloPreset = {
  id: string;
  category: SoloPresetCategory;
  title: string;
  subtitle: string;
  intention: string;
  minutes: SoloPresetDuration;
  tags: string[];
  lines: string[];
};

export const SOLO_PRESET_CATEGORIES = [
  "All",
  "Relationships",
  "Wellbeing",
  "Abundance",
  "World",
] as const;

export type SoloPresetFilterCategory = (typeof SOLO_PRESET_CATEGORIES)[number];

export const SOLO_PRESET_CATALOG: SoloPreset[] = [
  {
    id: "family",
    category: "Relationships",
    title: "Prayer for Family",
    subtitle: "Harmony, patience, and understanding at home.",
    intention: "peace, unity, and healing for my family",
    minutes: 5,
    tags: ["family", "home", "healing", "relationships"],
    lines: [
      "Divine Presence, cover my family with peace and protection.",
      "Bless every conversation in our home with patience and kindness.",
      "Heal old wounds and restore trust where distance has grown.",
      "Teach us to listen with empathy and speak with respect.",
      "Strengthen each parent, child, elder, and caregiver with grace.",
      "Replace anxiety in our home with calm and understanding.",
      "Guide us to forgive quickly and love generously.",
      "Lead us in wise decisions that honor one another.",
      "Protect our home from conflict, confusion, and fear.",
      "Fill our family with unity, joy, and lasting harmony.",
      "We receive healing that is already moving through us.",
    ],
  },
  {
    id: "health",
    category: "Wellbeing",
    title: "Prayer for Health",
    subtitle: "Strength for body, mind, and spirit.",
    intention: "restoration, strength, and calm for my health",
    minutes: 10,
    tags: ["health", "recovery", "calm", "strength"],
    lines: [
      "Source of life, I place my body, mind, and spirit in your care.",
      "Let healing move through every organ, tissue, and cell.",
      "Restore healthy rhythm to my breath, heartbeat, and sleep.",
      "Calm my nervous system and settle my racing thoughts.",
      "Lift fear and replace it with trust and resilience.",
      "Guide my doctors, caregivers, and supporters with wisdom.",
      "Lead me to right treatments, right timing, and right choices.",
      "Renew my energy where fatigue has taken hold.",
      "Strengthen my immune system and inner vitality.",
      "Protect me from discouragement and hopelessness.",
      "Give me patience for the process and courage for each day.",
      "Let small improvements grow into full restoration.",
      "Bless my body to recover with grace and steadiness.",
      "Bless my mind to stay clear, focused, and hopeful.",
      "Bless my spirit to remain rooted in peace.",
      "I receive healing, strength, and calm in this moment.",
    ],
  },
  {
    id: "friends",
    category: "Relationships",
    title: "Prayer for Friends",
    subtitle: "Connection, protection, and support.",
    intention: "protection, joy, and support for my friends",
    minutes: 5,
    tags: ["friends", "community", "care", "relationships"],
    lines: [
      "Loving Presence, bless my friends with peace and protection.",
      "Strengthen them in moments of pressure, grief, or uncertainty.",
      "Guide each friend toward wisdom, courage, and healthy choices.",
      "Provide support where they feel unseen or overwhelmed.",
      "Surround them with trustworthy people and safe community.",
      "Protect our friendships from misunderstanding and distance.",
      "Deepen loyalty, honesty, and mutual care between us.",
      "Multiply joy, laughter, and life-giving connection.",
      "Thank you for the gift of friendship and shared growth.",
    ],
  },
  {
    id: "wealth",
    category: "Abundance",
    title: "Prayer for Financial Flow",
    subtitle: "Wisdom, opportunity, and steady growth.",
    intention: "clarity, discipline, and healthy abundance",
    minutes: 5,
    tags: ["wealth", "abundance", "focus", "work"],
    lines: [
      "Source of provision, align me with ethical abundance.",
      "Replace scarcity and fear with clarity and trust.",
      "Give me discipline to steward money with wisdom.",
      "Guide my work toward service, excellence, and value.",
      "Open doors that are honest, sustainable, and aligned.",
      "Connect me with trusted people and meaningful opportunities.",
      "Strengthen my focus to complete what I have started.",
      "Bless my finances with order, growth, and stability.",
      "Help me use abundance to bless others with generosity.",
      "I receive healthy financial flow with gratitude and humility.",
    ],
  },
  {
    id: "world",
    category: "World",
    title: "Prayer for the World",
    subtitle: "Collective peace and compassionate action.",
    intention: "collective peace, protection, and courageous compassion",
    minutes: 10,
    tags: ["world", "collective", "peace", "humanity"],
    lines: [
      "Holy Presence, hold our world in peace and mercy.",
      "Comfort those in grief, conflict, displacement, and fear.",
      "Protect children, families, and vulnerable communities.",
      "Strengthen caregivers, peacemakers, and frontline workers.",
      "Guide leaders toward wisdom, restraint, and justice.",
      "Disarm hatred and soften hearts hardened by pain.",
      "Restore dignity where there has been violence or neglect.",
      "Provide food, shelter, and safe passage to those in need.",
      "Unite nations in practical cooperation and shared humanity.",
      "Empower communities to rebuild with courage and compassion.",
      "Let truth, mercy, and accountability rise together.",
      "Raise up courageous voices for reconciliation and healing.",
      "Teach us to turn prayer into action in daily life.",
      "May every small act of kindness multiply across the earth.",
      "We release this world into the highest good with hope.",
    ],
  },
  {
    id: "purpose",
    category: "Abundance",
    title: "Prayer for Purpose",
    subtitle: "Alignment with your next right step.",
    intention: "clarity and courage to follow my purpose",
    minutes: 3,
    tags: ["purpose", "clarity", "courage", "direction"],
    lines: [
      "Divine guide, reveal my next right step with clarity.",
      "Quiet distraction, pressure, and comparison within me.",
      "Align my gifts with service that truly matters.",
      "Give me courage to act instead of postponing.",
      "Help me choose integrity, consistency, and focus.",
      "I commit to one concrete action in faith today.",
      "Thank you for purpose unfolding with each faithful step.",
    ],
  },
];

export function filterSoloPresets(category: SoloPresetFilterCategory): SoloPreset[] {
  if (category === "All") return SOLO_PRESET_CATALOG;
  return SOLO_PRESET_CATALOG.filter((preset) => preset.category === category);
}

export function getSoloPresetById(id: string): SoloPreset | null {
  const found = SOLO_PRESET_CATALOG.find((preset) => preset.id === id);
  return found ?? null;
}
