import { Platform } from "react-native";
import { supabase } from "../../supabase/client";

export type MonetizationEventName =
  | "circle_purchase"
  | "circle_restore"
  | "billing_status_refresh";

export type MonetizationEventStage =
  | "attempt"
  | "success"
  | "failure"
  | "cancelled"
  | "info";

type LogMonetizationEventArgs = {
  userId: string;
  eventName: MonetizationEventName;
  stage: MonetizationEventStage;
  provider?: string;
  packageIdentifier?: string;
  entitlementId?: string;
  isCircleMember?: boolean | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
};

const DEFAULT_PROVIDER = "revenuecat";
const DEFAULT_ENTITLEMENT_ID =
  String(process.env.EXPO_PUBLIC_RC_ENTITLEMENT_CIRCLE ?? "").trim() ||
  "egregor_circle";

function safeText(value: unknown) {
  return String(value ?? "").trim();
}

function clip(value: unknown, max: number) {
  const clean = safeText(value).replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

function safeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function logMonetizationEvent(args: LogMonetizationEventArgs) {
  const userId = safeText(args.userId);
  if (!userId) return;

  const { error } = await (supabase as any).from("monetization_event_log").insert({
    user_id: userId,
    event_name: args.eventName,
    stage: args.stage,
    provider: safeText(args.provider) || DEFAULT_PROVIDER,
    platform: Platform.OS,
    package_identifier: safeText(args.packageIdentifier) || null,
    entitlement_id: safeText(args.entitlementId) || DEFAULT_ENTITLEMENT_ID,
    is_circle_member:
      typeof args.isCircleMember === "boolean" ? args.isCircleMember : null,
    error_message: clip(args.errorMessage, 240) || null,
    metadata: safeMetadata(args.metadata),
  });

  if (error) {
    // best-effort telemetry only
    console.log("[billing-analytics] insert failed", error.message);
  }
}
