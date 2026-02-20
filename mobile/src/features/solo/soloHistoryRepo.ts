import AsyncStorage from "@react-native-async-storage/async-storage";

export type SoloHistoryEntry = {
  id: string;
  completedAt: string;
  intent: string;
  language: string;
  ambientPreset: string;
  breathMode: string;
  minutes: number;
};

const KEY_SOLO_HISTORY = "solo:history:v1";

function safeTimeMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

export async function listSoloHistory(): Promise<SoloHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SOLO_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const rows = parsed
      .map((r: any) => ({
        id: String(r?.id ?? ""),
        completedAt: String(r?.completedAt ?? ""),
        intent: String(r?.intent ?? ""),
        language: String(r?.language ?? ""),
        ambientPreset: String(r?.ambientPreset ?? ""),
        breathMode: String(r?.breathMode ?? ""),
        minutes: Number(r?.minutes ?? 0),
      }))
      .filter(
        (r: SoloHistoryEntry) =>
          !!r.id && !!r.completedAt && Number.isFinite(r.minutes) && r.minutes > 0
      );
    rows.sort(
      (a: SoloHistoryEntry, b: SoloHistoryEntry) =>
        safeTimeMs(b.completedAt) - safeTimeMs(a.completedAt)
    );
    return rows.slice(0, 500);
  } catch {
    return [];
  }
}

export async function appendSoloHistory(
  entry: Omit<SoloHistoryEntry, "id">
): Promise<void> {
  const cur = await listSoloHistory();
  const next: SoloHistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
  const merged = [next, ...cur].slice(0, 500);
  await AsyncStorage.setItem(KEY_SOLO_HISTORY, JSON.stringify(merged));
}

export async function getSoloHistoryStats(days = 7): Promise<{
  sessionCount: number;
  totalMinutes: number;
  lastCompletedAt: string | null;
}> {
  const rows = await listSoloHistory();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const filtered = rows.filter((r) => safeTimeMs(r.completedAt) >= cutoff);
  return {
    sessionCount: filtered.length,
    totalMinutes: filtered.reduce((sum, r) => sum + Math.max(0, r.minutes), 0),
    lastCompletedAt: rows[0]?.completedAt ?? null,
  };
}

