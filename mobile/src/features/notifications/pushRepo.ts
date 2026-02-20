import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { supabase } from "../../supabase/client";
import type { Database } from "../../types/db";

type PushTokenRowInsert = Database["public"]["Tables"]["user_push_tokens"]["Insert"];
type PushTokenRowUpdate = Database["public"]["Tables"]["user_push_tokens"]["Update"];

export type RegisterPushTokenResult =
  | { ok: true; token: string }
  | { ok: false; reason: string; error?: string };

const PROJECT_ID_PLACEHOLDER = "REPLACE_WITH_EAS_PROJECT_ID_LATER";
const FALLBACK_PROJECT_ID = String(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "").trim();
const KEY_LAST_PUSH_TOKEN = "push:lastExpoToken:v1";

let notificationsConfigured = false;

function configureNotificationHandlerOnce() {
  if (notificationsConfigured) return;
  notificationsConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function isLikelyUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    v
  );
}

function safeString(v: unknown) {
  return String(v ?? "").trim();
}

function resolveProjectId() {
  const fromEasConfig = safeString((Constants as any)?.easConfig?.projectId);
  const fromExpoExtra = safeString((Constants as any)?.expoConfig?.extra?.eas?.projectId);
  const fromFallback = safeString(FALLBACK_PROJECT_ID);
  const projectId = fromEasConfig || fromExpoExtra || fromFallback;
  if (!projectId || projectId === PROJECT_ID_PLACEHOLDER) return "";
  return projectId;
}

function resolveAppVersion() {
  const fromExpoConfig = safeString((Constants as any)?.expoConfig?.version);
  const fromManifest = safeString((Constants as any)?.manifest2?.runtimeVersion);
  return fromExpoConfig || fromManifest || null;
}

function hasPushPermission(status: Notifications.NotificationPermissionsStatus) {
  if (status.granted) return true;
  const iosStatus = Number((status as any)?.ios?.status ?? 0);
  return iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

async function readStoredPushToken() {
  try {
    const raw = await AsyncStorage.getItem(KEY_LAST_PUSH_TOKEN);
    return safeString(raw);
  } catch {
    return "";
  }
}

async function writeStoredPushToken(token: string) {
  try {
    if (!token) {
      await AsyncStorage.removeItem(KEY_LAST_PUSH_TOKEN);
      return;
    }
    await AsyncStorage.setItem(KEY_LAST_PUSH_TOKEN, token);
  } catch {
    // ignore
  }
}

async function ensurePushPermissionGranted() {
  const current = await Notifications.getPermissionsAsync();
  if (hasPushPermission(current)) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return hasPushPermission(requested);
}

export function ensurePushNotificationsConfigured() {
  configureNotificationHandlerOnce();
}

export async function registerPushTokenForCurrentUser(): Promise<RegisterPushTokenResult> {
  configureNotificationHandlerOnce();

  if (!Device.isDevice) {
    return { ok: false, reason: "not_device" };
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user) {
    return { ok: false, reason: "no_user", error: userErr?.message };
  }

  const granted = await ensurePushPermissionGranted();
  if (!granted) {
    return { ok: false, reason: "permission_denied" };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#5B8CFF",
    });
  }

  let expoPushToken = "";
  try {
    const projectId = resolveProjectId();
    const tokenResult = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    expoPushToken = safeString(tokenResult?.data);
  } catch (e: any) {
    return {
      ok: false,
      reason: "token_request_failed",
      error: e?.message ?? "Unknown token error",
    };
  }

  if (!expoPushToken) {
    return { ok: false, reason: "missing_token" };
  }

  const { data: existingRows, error: selectErr } = await supabase
    .from("user_push_tokens")
    .select("id")
    .eq("user_id", user.id)
    .eq("expo_push_token", expoPushToken)
    .limit(1);

  if (selectErr) {
    return { ok: false, reason: "token_select_failed", error: selectErr.message };
  }

  const existingId = safeString((existingRows ?? [])[0]?.id);
  const nowIso = new Date().toISOString();

  if (existingId) {
    const updatePayload: PushTokenRowUpdate = {
      app_version: resolveAppVersion(),
      device_name: Device.deviceName ?? null,
      platform: Platform.OS,
      updated_at: nowIso,
    };
    const { error: updateErr } = await supabase
      .from("user_push_tokens")
      .update(updatePayload)
      .eq("id", existingId)
      .eq("user_id", user.id);
    if (updateErr) {
      return { ok: false, reason: "token_update_failed", error: updateErr.message };
    }
    const previousToken = await readStoredPushToken();
    if (previousToken && previousToken !== expoPushToken) {
      await supabase
        .from("user_push_tokens")
        .delete()
        .eq("user_id", user.id)
        .eq("expo_push_token", previousToken);
    }
    await writeStoredPushToken(expoPushToken);
    return { ok: true, token: expoPushToken };
  }

  const insertPayload: PushTokenRowInsert = {
    user_id: user.id,
    expo_push_token: expoPushToken,
    app_version: resolveAppVersion(),
    device_name: Device.deviceName ?? null,
    platform: Platform.OS,
    updated_at: nowIso,
  };

  const { error: insertErr } = await supabase.from("user_push_tokens").insert(insertPayload);
  if (insertErr) {
    return { ok: false, reason: "token_insert_failed", error: insertErr.message };
  }

  const previousToken = await readStoredPushToken();
  if (previousToken && previousToken !== expoPushToken) {
    await supabase
      .from("user_push_tokens")
      .delete()
      .eq("user_id", user.id)
      .eq("expo_push_token", previousToken);
  }
  await writeStoredPushToken(expoPushToken);

  return { ok: true, token: expoPushToken };
}

export async function unregisterPushTokenForCurrentUser() {
  const token = await readStoredPushToken();
  if (!token) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id) {
    await supabase
      .from("user_push_tokens")
      .delete()
      .eq("user_id", user.id)
      .eq("expo_push_token", token);
  }

  await writeStoredPushToken("");
}

export function extractEventIdFromNotificationData(data: unknown): string | null {
  let raw = data;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;

  const record = raw as Record<string, unknown>;
  const directCandidates = [
    record.eventId,
    record.event_id,
    record.eventID,
    (record.event as any)?.id,
    (record.payload as any)?.eventId,
    (record.payload as any)?.event_id,
  ];

  for (const value of directCandidates) {
    const id = safeString(value);
    if (isLikelyUuid(id)) return id;
  }

  return null;
}
