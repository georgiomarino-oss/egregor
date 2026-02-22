import { Platform } from "react-native";

export type CirclePackage = {
  identifier: string;
  packageType: string;
  title: string;
  priceString: string;
};

export type BillingSnapshot = {
  available: boolean;
  configured: boolean;
  entitlementId: string;
  isCircleMember: boolean;
  expiresAt: string | null;
  packages: CirclePackage[];
  error: string | null;
};

type EnsureConfiguredResult = {
  ok: boolean;
  available: boolean;
  configured: boolean;
  error: string | null;
};

const ENTITLEMENT_ID =
  String(process.env.EXPO_PUBLIC_RC_ENTITLEMENT_CIRCLE ?? "").trim() ||
  "egregor_circle";
const IOS_API_KEY = String(process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? "").trim();
const ANDROID_API_KEY = String(process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? "").trim();

let sdkConfigured = false;
let configuredUserId = "";
let purchasesModulePromise: Promise<any | null> | null = null;

async function getPurchasesModule() {
  if (!purchasesModulePromise) {
    purchasesModulePromise = import("react-native-purchases")
      .then((mod: any) => mod?.default ?? mod)
      .catch(() => null);
  }
  return purchasesModulePromise;
}

function supportsNativeBilling() {
  return Platform.OS === "ios" || Platform.OS === "android";
}

function platformApiKey() {
  if (Platform.OS === "ios") return IOS_API_KEY;
  if (Platform.OS === "android") return ANDROID_API_KEY;
  return "";
}

function baseSnapshot(partial?: Partial<BillingSnapshot>): BillingSnapshot {
  return {
    available: false,
    configured: false,
    entitlementId: ENTITLEMENT_ID,
    isCircleMember: false,
    expiresAt: null,
    packages: [],
    error: null,
    ...partial,
  };
}

function asArray<T = any>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function parseCustomerEntitlement(customerInfo: any) {
  const active = customerInfo?.entitlements?.active ?? {};
  const direct = active?.[ENTITLEMENT_ID] ?? null;
  if (direct) {
    return {
      isCircleMember: true,
      expiresAt: String(direct?.expirationDate ?? "").trim() || null,
    };
  }

  const activeEntries = Object.values(active ?? {}) as any[];
  const fallback = activeEntries[0] ?? null;
  if (!fallback) {
    return { isCircleMember: false, expiresAt: null };
  }
  return {
    isCircleMember: true,
    expiresAt: String((fallback as any)?.expirationDate ?? "").trim() || null,
  };
}

function mapPackages(offerings: any): CirclePackage[] {
  const byId: Record<string, CirclePackage> = {};
  const push = (pkg: any) => {
    const identifier = String(pkg?.identifier ?? "").trim();
    if (!identifier) return;

    const product = pkg?.product ?? {};
    byId[identifier] = {
      identifier,
      packageType: String(pkg?.packageType ?? "unknown"),
      title:
        String(product?.title ?? "").trim() ||
        String(product?.identifier ?? "").trim() ||
        identifier,
      priceString: String(product?.priceString ?? "").trim() || "",
    };
  };

  const currentPackages = asArray<any>(offerings?.current?.availablePackages);
  for (const pkg of currentPackages) push(pkg);

  const allOfferings = Object.values(offerings?.all ?? {}) as any[];
  for (const offering of allOfferings) {
    for (const pkg of asArray<any>(offering?.availablePackages)) push(pkg);
  }

  return Object.values(byId);
}

function pickBestPackage(offerings: any, packageIdentifier?: string) {
  const wanted = String(packageIdentifier ?? "").trim();
  const currentPackages = asArray<any>(offerings?.current?.availablePackages);
  const allOfferings = Object.values(offerings?.all ?? {}) as any[];
  const flattened = [
    ...currentPackages,
    ...allOfferings.flatMap((offering) => asArray<any>((offering as any)?.availablePackages)),
  ];

  const uniqById: Record<string, any> = {};
  for (const pkg of flattened) {
    const id = String(pkg?.identifier ?? "").trim();
    if (!id || uniqById[id]) continue;
    uniqById[id] = pkg;
  }
  const packages = Object.values(uniqById);
  if (packages.length === 0) return null;

  if (wanted) {
    const match = packages.find(
      (pkg) => String((pkg as any)?.identifier ?? "").trim() === wanted
    );
    if (match) return match;
  }

  const annual = packages.find(
    (pkg) => String((pkg as any)?.packageType ?? "").toUpperCase() === "ANNUAL"
  );
  if (annual) return annual;

  const monthly = packages.find(
    (pkg) => String((pkg as any)?.packageType ?? "").toUpperCase() === "MONTHLY"
  );
  if (monthly) return monthly;

  return packages[0];
}

async function ensureConfigured(userId: string): Promise<EnsureConfiguredResult> {
  if (!supportsNativeBilling()) {
    return {
      ok: false,
      available: false,
      configured: false,
      error: "In-app purchases are available on iOS and Android only.",
    };
  }

  const apiKey = platformApiKey();
  if (!apiKey) {
    return {
      ok: false,
      available: false,
      configured: false,
      error: "In-app purchases are not configured for this build.",
    };
  }

  const Purchases = await getPurchasesModule();
  if (!Purchases) {
    return {
      ok: false,
      available: false,
      configured: false,
      error: "In-app purchase services are unavailable on this build.",
    };
  }

  try {
    if (!sdkConfigured) {
      try {
        const level = (Purchases as any)?.LOG_LEVEL?.WARN ?? (Purchases as any)?.LOG_LEVEL?.DEBUG;
        if ((Purchases as any)?.setLogLevel && level) {
          (Purchases as any).setLogLevel(level);
        }
      } catch {
        // ignore
      }
      await Purchases.configure({
        apiKey,
        appUserID: userId || undefined,
      } as any);
      sdkConfigured = true;
      configuredUserId = userId;
      return { ok: true, available: true, configured: true, error: null };
    }

    if (userId && configuredUserId && configuredUserId !== userId) {
      await Purchases.logIn(userId);
      configuredUserId = userId;
    } else if (userId && !configuredUserId) {
      await Purchases.logIn(userId);
      configuredUserId = userId;
    }

    return { ok: true, available: true, configured: true, error: null };
  } catch (e: any) {
    return {
      ok: false,
      available: true,
      configured: false,
      error: "We couldn't initialize in-app purchases right now.",
    };
  }
}

export async function refreshBillingSnapshot(userId: string): Promise<BillingSnapshot> {
  const ensure = await ensureConfigured(userId);
  if (!ensure.ok) {
    return baseSnapshot({
      available: ensure.available,
      configured: ensure.configured,
      error: ensure.error,
    });
  }

  const Purchases = await getPurchasesModule();
  if (!Purchases) {
    return baseSnapshot({
      available: false,
      configured: false,
      error: "In-app purchase services are unavailable on this build.",
    });
  }

  try {
    const [customerInfo, offerings] = await Promise.all([
      Purchases.getCustomerInfo(),
      Purchases.getOfferings(),
    ]);
    const ent = parseCustomerEntitlement(customerInfo);
    return baseSnapshot({
      available: true,
      configured: true,
      isCircleMember: ent.isCircleMember,
      expiresAt: ent.expiresAt,
      packages: mapPackages(offerings),
      error: null,
    });
  } catch (e: any) {
    return baseSnapshot({
      available: true,
      configured: true,
      error: "We couldn't load your billing status right now.",
    });
  }
}

export async function purchaseCircleMembership(args: {
  userId: string;
  packageIdentifier?: string;
}): Promise<BillingSnapshot> {
  const ensure = await ensureConfigured(args.userId);
  if (!ensure.ok) {
    return baseSnapshot({
      available: ensure.available,
      configured: ensure.configured,
      error: ensure.error,
    });
  }

  const Purchases = await getPurchasesModule();
  if (!Purchases) {
    return baseSnapshot({
      available: false,
      configured: false,
      error: "In-app purchase services are unavailable on this build.",
    });
  }

  try {
    const offerings = await Purchases.getOfferings();
    const selected = pickBestPackage(offerings, args.packageIdentifier);
    if (!selected) {
      return baseSnapshot({
        available: true,
        configured: true,
        error: "No purchasable package is available.",
      });
    }

    const result = await Purchases.purchasePackage(selected);
    const customerInfo = (result as any)?.customerInfo ?? {};
    const ent = parseCustomerEntitlement(customerInfo);
    return baseSnapshot({
      available: true,
      configured: true,
      isCircleMember: ent.isCircleMember,
      expiresAt: ent.expiresAt,
      packages: mapPackages(offerings),
      error: null,
    });
  } catch (e: any) {
    const isCancel = !!(e as any)?.userCancelled;
    return baseSnapshot({
      available: true,
      configured: true,
      error: isCancel ? "Purchase cancelled." : "We couldn't complete this purchase right now.",
    });
  }
}

export async function restoreCircleMembership(userId: string): Promise<BillingSnapshot> {
  const ensure = await ensureConfigured(userId);
  if (!ensure.ok) {
    return baseSnapshot({
      available: ensure.available,
      configured: ensure.configured,
      error: ensure.error,
    });
  }

  const Purchases = await getPurchasesModule();
  if (!Purchases) {
    return baseSnapshot({
      available: false,
      configured: false,
      error: "In-app purchase services are unavailable on this build.",
    });
  }

  try {
    const [customerInfo, offerings] = await Promise.all([
      Purchases.restorePurchases(),
      Purchases.getOfferings(),
    ]);
    const ent = parseCustomerEntitlement(customerInfo);
    return baseSnapshot({
      available: true,
      configured: true,
      isCircleMember: ent.isCircleMember,
      expiresAt: ent.expiresAt,
      packages: mapPackages(offerings),
      error: null,
    });
  } catch (e: any) {
    return baseSnapshot({
      available: true,
      configured: true,
      error: "We couldn't restore purchases right now.",
    });
  }
}

export async function logoutBilling() {
  if (!sdkConfigured) return;
  const Purchases = await getPurchasesModule();
  if (!Purchases) return;
  try {
    await Purchases.logOut();
  } catch {
    // ignore
  } finally {
    configuredUserId = "";
  }
}
