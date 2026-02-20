import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAppState } from "../state";
import { getAppColors } from "../theme/appearance";
import { supabase } from "../supabase/client";

type SubscriptionRow = {
  provider: string | null;
  entitlement_id: string | null;
  is_active: boolean | null;
  product_id: string | null;
  store: string | null;
  environment: string | null;
  expires_at: string | null;
  last_event_type: string | null;
  last_event_id: string | null;
  last_event_timestamp: string | null;
  updated_at: string | null;
};

type WebhookLogRow = {
  event_id: string | null;
  event_type: string | null;
  process_status: string | null;
  error_message: string | null;
  event_timestamp: string | null;
  product_id: string | null;
  store: string | null;
  environment: string | null;
  received_at: string | null;
  processed_at: string | null;
};

type MonetizationEventRow = {
  event_name: string | null;
  stage: string | null;
  provider: string | null;
  platform: string | null;
  package_identifier: string | null;
  entitlement_id: string | null;
  is_circle_member: boolean | null;
  error_message: string | null;
  created_at: string | null;
  metadata: Record<string, unknown> | null;
};

type FunnelCounts = {
  paywallViews: number;
  paywallCtaTaps: number;
  purchaseAttempts: number;
  purchaseSuccess: number;
  purchaseFailure: number;
  purchaseCancelled: number;
  restoreAttempts: number;
  restoreSuccess: number;
  restoreFailure: number;
  refreshAttempts: number;
  refreshSuccess: number;
  debugOpenCount: number;
  aiEventScriptAttempts: number;
  aiEventScriptSuccess: number;
  aiEventScriptPremiumSuccess: number;
  aiSoloGuidanceAttempts: number;
  aiSoloGuidanceSuccess: number;
  aiSoloGuidancePremiumSuccess: number;
  membershipSyncSuccess: number;
  membershipSyncFailure: number;
};

const EMPTY_FUNNEL_COUNTS: FunnelCounts = {
  paywallViews: 0,
  paywallCtaTaps: 0,
  purchaseAttempts: 0,
  purchaseSuccess: 0,
  purchaseFailure: 0,
  purchaseCancelled: 0,
  restoreAttempts: 0,
  restoreSuccess: 0,
  restoreFailure: 0,
  refreshAttempts: 0,
  refreshSuccess: 0,
  debugOpenCount: 0,
  aiEventScriptAttempts: 0,
  aiEventScriptSuccess: 0,
  aiEventScriptPremiumSuccess: 0,
  aiSoloGuidanceAttempts: 0,
  aiSoloGuidanceSuccess: 0,
  aiSoloGuidancePremiumSuccess: 0,
  membershipSyncSuccess: 0,
  membershipSyncFailure: 0,
};

function clip(input: string, max: number) {
  const clean = String(input ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}...`;
}

function safeIso(value: string | null | undefined) {
  const iso = String(value ?? "").trim();
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  return new Date(ts).toLocaleString();
}

function safeText(value: string | null | undefined, fallback = "-") {
  const next = String(value ?? "").trim();
  return next || fallback;
}

function ratioLabel(success: number, total: number) {
  if (total <= 0) return "-";
  const pct = Math.round((success / total) * 100);
  return `${pct}% (${success}/${total})`;
}

async function countMonetizationEvents(args: {
  userId: string;
  eventName: string;
  stage?: string;
  metadataContains?: Record<string, unknown>;
}) {
  let query = supabase
    .from("monetization_event_log")
    .select("id", { head: true, count: "exact" })
    .eq("user_id", args.userId)
    .eq("event_name", args.eventName);

  if (args.stage) {
    query = query.eq("stage", args.stage);
  }
  if (args.metadataContains && Object.keys(args.metadataContains).length > 0) {
    query = query.contains("metadata", args.metadataContains);
  }

  const { count, error } = await query;
  return {
    count: typeof count === "number" ? count : 0,
    error: error ? String(error.message ?? "unknown error") : "",
  };
}

export default function BillingDebugScreen() {
  const {
    user,
    theme,
    highContrast,
    billingReady,
    billingAvailable,
    billingError,
    isCircleMember,
    circleExpiresAt,
    circlePackages,
    refreshBilling,
  } = useAppState();
  const c = useMemo(() => getAppColors(theme, highContrast), [theme, highContrast]);
  const [loading, setLoading] = useState(false);
  const [serverIsCircleMember, setServerIsCircleMember] = useState<boolean | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [subscriptionRows, setSubscriptionRows] = useState<SubscriptionRow[]>([]);
  const [webhookRows, setWebhookRows] = useState<WebhookLogRow[]>([]);
  const [monetizationRows, setMonetizationRows] = useState<MonetizationEventRow[]>([]);
  const [funnelCounts, setFunnelCounts] = useState<FunnelCounts>(EMPTY_FUNNEL_COUNTS);
  const [lastSyncAt, setLastSyncAt] = useState("");
  const loadInFlightRef = useRef(false);
  const queuedLoadRef = useRef(false);

  const load = useCallback(async () => {
    if (loadInFlightRef.current) {
      queuedLoadRef.current = true;
      return;
    }
    loadInFlightRef.current = true;
    setLoading(true);

    try {
      const uid = user?.id ?? "";
      if (!uid) {
        setServerIsCircleMember(null);
        setServerError("No authenticated user.");
        setSubscriptionRows([]);
        setWebhookRows([]);
        setMonetizationRows([]);
        setFunnelCounts(EMPTY_FUNNEL_COUNTS);
        setLastSyncAt(new Date().toISOString());
        return;
      }

      const [
        rpcResult,
        subResult,
        hookResult,
        monetizationResult,
        paywallViewCount,
        paywallTapCount,
        purchaseAttemptCount,
        purchaseSuccessCount,
        purchaseFailureCount,
        purchaseCancelledCount,
        restoreAttemptCount,
        restoreSuccessCount,
        restoreFailureCount,
        refreshAttemptCount,
        refreshSuccessCount,
        debugOpenCount,
        aiEventScriptAttemptCount,
        aiEventScriptSuccessCount,
        aiEventScriptPremiumSuccessCount,
        aiSoloGuidanceAttemptCount,
        aiSoloGuidanceSuccessCount,
        aiSoloGuidancePremiumSuccessCount,
        membershipSyncSuccessCount,
        membershipSyncFailureCount,
      ] = await Promise.all([
        supabase.rpc("is_circle_member", { p_user_id: uid }),
        supabase
          .from("user_subscription_state")
          .select(
            "provider,entitlement_id,is_active,product_id,store,environment,expires_at,last_event_type,last_event_id,last_event_timestamp,updated_at"
          )
          .eq("user_id", uid)
          .order("updated_at", { ascending: false })
          .limit(20),
        supabase
          .from("revenuecat_webhook_events")
          .select(
            "event_id,event_type,process_status,error_message,event_timestamp,product_id,store,environment,received_at,processed_at"
          )
          .eq("user_id", uid)
          .order("received_at", { ascending: false })
          .limit(30),
        supabase
          .from("monetization_event_log")
          .select(
            "event_name,stage,provider,platform,package_identifier,entitlement_id,is_circle_member,error_message,created_at,metadata"
          )
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(40),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_paywall_view",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_paywall_cta_tap",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_purchase",
          stage: "attempt",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_purchase",
          stage: "success",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_purchase",
          stage: "failure",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_purchase",
          stage: "cancelled",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_restore",
          stage: "attempt",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_restore",
          stage: "success",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_restore",
          stage: "failure",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "billing_status_refresh",
          stage: "attempt",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "billing_status_refresh",
          stage: "success",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "billing_debug_open",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "premium_feature_use",
          stage: "attempt",
          metadataContains: { feature: "ai_event_script_generate" },
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "premium_feature_use",
          stage: "success",
          metadataContains: { feature: "ai_event_script_generate" },
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "premium_feature_use",
          stage: "success",
          metadataContains: {
            feature: "ai_event_script_generate",
            isPremium: true,
          },
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "premium_feature_use",
          stage: "attempt",
          metadataContains: { feature: "ai_solo_guidance_generate" },
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "premium_feature_use",
          stage: "success",
          metadataContains: { feature: "ai_solo_guidance_generate" },
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "premium_feature_use",
          stage: "success",
          metadataContains: {
            feature: "ai_solo_guidance_generate",
            isPremium: true,
          },
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_membership_sync",
          stage: "success",
        }),
        countMonetizationEvents({
          userId: uid,
          eventName: "circle_membership_sync",
          stage: "failure",
        }),
      ]);

      const errors: string[] = [];
      if (rpcResult.error) {
        errors.push(`rpc is_circle_member: ${rpcResult.error.message}`);
        setServerIsCircleMember(null);
      } else {
        setServerIsCircleMember(!!rpcResult.data);
      }

      if (subResult.error) {
        errors.push(`user_subscription_state: ${subResult.error.message}`);
        setSubscriptionRows([]);
      } else {
        const rows = Array.isArray(subResult.data)
          ? (subResult.data as SubscriptionRow[])
          : [];
        setSubscriptionRows(rows);
      }

      if (hookResult.error) {
        errors.push(`revenuecat_webhook_events: ${hookResult.error.message}`);
        setWebhookRows([]);
      } else {
        const rows = Array.isArray(hookResult.data) ? (hookResult.data as WebhookLogRow[]) : [];
        setWebhookRows(rows);
      }

      if (monetizationResult.error) {
        errors.push(`monetization_event_log: ${monetizationResult.error.message}`);
        setMonetizationRows([]);
      } else {
        const rows = Array.isArray(monetizationResult.data)
          ? (monetizationResult.data as MonetizationEventRow[])
          : [];
        setMonetizationRows(rows);
      }

      const counterErrors = [
        paywallViewCount,
        paywallTapCount,
        purchaseAttemptCount,
        purchaseSuccessCount,
        purchaseFailureCount,
        purchaseCancelledCount,
        restoreAttemptCount,
        restoreSuccessCount,
        restoreFailureCount,
        refreshAttemptCount,
        refreshSuccessCount,
        debugOpenCount,
        aiEventScriptAttemptCount,
        aiEventScriptSuccessCount,
        aiEventScriptPremiumSuccessCount,
        aiSoloGuidanceAttemptCount,
        aiSoloGuidanceSuccessCount,
        aiSoloGuidancePremiumSuccessCount,
        membershipSyncSuccessCount,
        membershipSyncFailureCount,
      ]
        .map((row) => row.error)
        .filter(Boolean);
      if (counterErrors.length) {
        errors.push(`monetization counters: ${counterErrors.join(" | ")}`);
      }

      setFunnelCounts({
        paywallViews: paywallViewCount.count,
        paywallCtaTaps: paywallTapCount.count,
        purchaseAttempts: purchaseAttemptCount.count,
        purchaseSuccess: purchaseSuccessCount.count,
        purchaseFailure: purchaseFailureCount.count,
        purchaseCancelled: purchaseCancelledCount.count,
        restoreAttempts: restoreAttemptCount.count,
        restoreSuccess: restoreSuccessCount.count,
        restoreFailure: restoreFailureCount.count,
        refreshAttempts: refreshAttemptCount.count,
        refreshSuccess: refreshSuccessCount.count,
        debugOpenCount: debugOpenCount.count,
        aiEventScriptAttempts: aiEventScriptAttemptCount.count,
        aiEventScriptSuccess: aiEventScriptSuccessCount.count,
        aiEventScriptPremiumSuccess: aiEventScriptPremiumSuccessCount.count,
        aiSoloGuidanceAttempts: aiSoloGuidanceAttemptCount.count,
        aiSoloGuidanceSuccess: aiSoloGuidanceSuccessCount.count,
        aiSoloGuidancePremiumSuccess: aiSoloGuidancePremiumSuccessCount.count,
        membershipSyncSuccess: membershipSyncSuccessCount.count,
        membershipSyncFailure: membershipSyncFailureCount.count,
      });

      setServerError(errors.length ? errors.join(" | ") : null);
      setLastSyncAt(new Date().toISOString());
    } finally {
      setLoading(false);
      loadInFlightRef.current = false;
      if (queuedLoadRef.current) {
        queuedLoadRef.current = false;
        void load();
      }
    }
  }, [user?.id]);

  const refreshAll = useCallback(async () => {
    await refreshBilling();
    await load();
  }, [load, refreshBilling]);

  useFocusEffect(
    useCallback(() => {
      let disposed = false;
      void load();
      const interval = setInterval(() => {
        if (disposed) return;
        void load();
      }, 30_000);

      return () => {
        disposed = true;
        clearInterval(interval);
      };
    }, [load])
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.h1, { color: c.text }]}>Billing Debug</Text>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Snapshot</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>User ID: {safeText(user?.id ?? null)}</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Local Circle member: {isCircleMember ? "true" : "false"}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Server Circle member:{" "}
            {serverIsCircleMember === null ? "-" : serverIsCircleMember ? "true" : "false"}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Billing ready/available: {billingReady ? "true" : "false"} /{" "}
            {billingAvailable ? "true" : "false"}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Expires at: {circleExpiresAt ? safeIso(circleExpiresAt) : "-"}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Packages loaded: {circlePackages.length}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Last sync: {lastSyncAt ? safeIso(lastSyncAt) : "-"}
          </Text>
          {!!billingError && (
            <Text style={[styles.warn, { color: "#FB7185" }]}>
              Local billing error: {clip(billingError, 280)}
            </Text>
          )}
          {!!serverError && (
            <Text style={[styles.warn, { color: "#FB7185" }]}>
              Server debug error: {clip(serverError, 280)}
            </Text>
          )}
          <View style={styles.row}>
            <Pressable
              style={[styles.btn, { backgroundColor: c.primary }, loading && styles.dimmed]}
              onPress={refreshAll}
              disabled={loading}
            >
              <Text style={styles.btnText}>{loading ? "Refreshing..." : "Refresh local + server"}</Text>
            </Pressable>
            <Pressable
              style={[styles.btnGhost, { borderColor: c.border, backgroundColor: c.cardAlt }, loading && styles.dimmed]}
              onPress={() => void load()}
              disabled={loading}
            >
              <Text style={[styles.btnGhostText, { color: c.text }]}>Refresh server only</Text>
            </Pressable>
          </View>
          {loading ? <ActivityIndicator style={{ marginTop: 6 }} /> : null}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Funnel Summary (All-Time)</Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Paywall views: {funnelCounts.paywallViews} | CTA taps: {funnelCounts.paywallCtaTaps}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Purchase attempts: {funnelCounts.purchaseAttempts} | success: {funnelCounts.purchaseSuccess} |
            failure: {funnelCounts.purchaseFailure} | cancelled: {funnelCounts.purchaseCancelled}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Purchase conversion:{" "}
            {ratioLabel(funnelCounts.purchaseSuccess, funnelCounts.purchaseAttempts)}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Membership sync: success {funnelCounts.membershipSyncSuccess} | failure{" "}
            {funnelCounts.membershipSyncFailure}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Restore attempts: {funnelCounts.restoreAttempts} | success: {funnelCounts.restoreSuccess} |
            failure: {funnelCounts.restoreFailure}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Restore success rate:{" "}
            {ratioLabel(funnelCounts.restoreSuccess, funnelCounts.restoreAttempts)}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Billing refresh attempts: {funnelCounts.refreshAttempts} | success:{" "}
            {funnelCounts.refreshSuccess}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Billing refresh success rate:{" "}
            {ratioLabel(funnelCounts.refreshSuccess, funnelCounts.refreshAttempts)}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            Billing debug opens: {funnelCounts.debugOpenCount}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            AI event-script generations: attempts {funnelCounts.aiEventScriptAttempts} | success{" "}
            {funnelCounts.aiEventScriptSuccess} | premium success{" "}
            {funnelCounts.aiEventScriptPremiumSuccess}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            AI event-script success rate:{" "}
            {ratioLabel(funnelCounts.aiEventScriptSuccess, funnelCounts.aiEventScriptAttempts)}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            AI solo-guidance generations: attempts {funnelCounts.aiSoloGuidanceAttempts} | success{" "}
            {funnelCounts.aiSoloGuidanceSuccess} | premium success{" "}
            {funnelCounts.aiSoloGuidancePremiumSuccess}
          </Text>
          <Text style={[styles.meta, { color: c.textMuted }]}>
            AI solo-guidance success rate:{" "}
            {ratioLabel(funnelCounts.aiSoloGuidanceSuccess, funnelCounts.aiSoloGuidanceAttempts)}
          </Text>
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Subscription Rows</Text>
          {subscriptionRows.length === 0 ? (
            <Text style={[styles.meta, { color: c.textMuted }]}>No rows returned.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {subscriptionRows.map((row, idx) => (
                <View
                  key={`${safeText(row.last_event_id, "none")}-${idx}`}
                  style={[styles.card, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                >
                  <Text style={[styles.title, { color: c.text }]}>
                    {safeText(row.provider)} / {safeText(row.entitlement_id)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    active={row.is_active ? "true" : "false"} | product={safeText(row.product_id)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    store={safeText(row.store)} | env={safeText(row.environment)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    expires={row.expires_at ? safeIso(row.expires_at) : "-"}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    last event={safeText(row.last_event_type)} / {safeText(row.last_event_id)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    last event ts={row.last_event_timestamp ? safeIso(row.last_event_timestamp) : "-"}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    updated={row.updated_at ? safeIso(row.updated_at) : "-"}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Webhook Event Log</Text>
          {webhookRows.length === 0 ? (
            <Text style={[styles.meta, { color: c.textMuted }]}>No webhook events found yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {webhookRows.map((row, idx) => (
                <View
                  key={`${safeText(row.event_id, "event")}-${idx}`}
                  style={[styles.card, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                >
                  <Text style={[styles.title, { color: c.text }]}>
                    {safeText(row.event_type)} | {safeText(row.process_status)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    event_id={clip(safeText(row.event_id, "-"), 80)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    product={safeText(row.product_id)} | store={safeText(row.store)} | env={safeText(row.environment)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    ts={row.event_timestamp ? safeIso(row.event_timestamp) : "-"}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    received={row.received_at ? safeIso(row.received_at) : "-"} | processed=
                    {row.processed_at ? safeIso(row.processed_at) : "-"}
                  </Text>
                  {!!row.error_message && (
                    <Text style={[styles.warn, { color: "#FB7185" }]}>
                      error: {clip(safeText(row.error_message), 240)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.sectionTitle, { color: c.text }]}>Client Monetization Events</Text>
          {monetizationRows.length === 0 ? (
            <Text style={[styles.meta, { color: c.textMuted }]}>
              No monetization client events found yet.
            </Text>
          ) : (
            <View style={{ gap: 8 }}>
              {monetizationRows.map((row, idx) => (
                <View
                  key={`${safeText(row.created_at, "at")}-${safeText(row.event_name, "event")}-${idx}`}
                  style={[styles.card, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                >
                  <Text style={[styles.title, { color: c.text }]}>
                    {safeText(row.event_name)} | {safeText(row.stage)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    provider={safeText(row.provider)} | platform={safeText(row.platform)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    package={safeText(row.package_identifier)} | entitlement=
                    {safeText(row.entitlement_id)}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    is_circle_member=
                    {row.is_circle_member === null
                      ? "-"
                      : row.is_circle_member
                        ? "true"
                        : "false"}
                  </Text>
                  <Text style={[styles.meta, { color: c.textMuted }]}>
                    at={row.created_at ? safeIso(row.created_at) : "-"}
                  </Text>
                  {!!row.error_message && (
                    <Text style={[styles.warn, { color: "#FB7185" }]}>
                      error: {clip(safeText(row.error_message), 220)}
                    </Text>
                  )}
                  {row.metadata && (
                    <Text style={[styles.meta, { color: c.textMuted }]}>
                      metadata={clip(JSON.stringify(row.metadata), 220)}
                    </Text>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 36, gap: 12 },
  h1: { fontSize: 26, fontWeight: "900" },
  section: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800" },
  title: { fontSize: 14, fontWeight: "800" },
  meta: { fontSize: 12, lineHeight: 17 },
  warn: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 4 },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 3,
  },
  btn: {
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: "#FFFFFF", fontWeight: "800" },
  btnGhost: {
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  btnGhostText: { fontWeight: "800" },
  dimmed: { opacity: 0.5 },
});
