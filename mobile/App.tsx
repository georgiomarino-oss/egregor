// mobile/App.tsx
import "react-native-gesture-handler";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Linking, Platform, View } from "react-native";
import {
  NavigationContainer,
  DefaultTheme,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

import AuthScreen from "./src/screens/AuthScreen";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import HomeScreen from "./src/screens/HomeScreen";
import SoloScreen from "./src/screens/SoloScreen";
import GlobalHeatMapScreen from "./src/screens/GlobalHeatMapScreen";
import EventsScreen from "./src/screens/EventsScreen";
import ScriptsScreen from "./src/screens/ScriptsScreen";
import EventRoomScreen from "./src/screens/EventRoomScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";
import BillingDebugScreen from "./src/screens/BillingDebugScreen";
import SoloSessionScreen from "./src/screens/SoloSessionScreen";
import JournalComposeScreen from "./src/screens/JournalComposeScreen";

import { AppStateProvider, useAppState } from "./src/state";
import type { RootStackParamList, RootTabParamList } from "./src/types";
import { getAppColors, getScreenColors, type ScreenContext } from "./src/theme/appearance";
import { supabase } from "./src/supabase/client";
import {
  ensurePushNotificationsConfigured,
  extractEventIdFromNotificationData,
  registerPushTokenForCurrentUser,
} from "./src/features/notifications/pushRepo";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<RootTabParamList>();
const rootNavRef = createNavigationContainerRef<RootStackParamList>();
const KEY_ONBOARDING_DONE = "onboarding:done:v1";
const KEY_DAILY_INTENTION = "onboarding:intention:v1";
type SupportedOtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";
const SUPPORTED_OTP_TYPES = new Set<SupportedOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function isSupportedOtpType(value: string): value is SupportedOtpType {
  return SUPPORTED_OTP_TYPES.has(value as SupportedOtpType);
}

function decodeMaybe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function getAuthLinkErrorMessage(rawMessage: string | null | undefined) {
  const message = String(rawMessage ?? "").toLowerCase();
  if (message.includes("expired") || message.includes("invalid")) {
    return "This link is no longer valid. Please request a new email and try again.";
  }
  return "We couldn't complete sign in from this link. Please request a new email and try again.";
}

function compactTabLabel(value: string, max = 11) {
  const cleaned = value.trim().replace(/\s+/g, " ");
  if (!cleaned) return "Profile";
  const first = cleaned.split(" ")[0] ?? cleaned;
  if (first.length <= max) return first;
  return `${first.slice(0, Math.max(3, max - 1))}.`;
}

function resolveProfileTabLabel(args: {
  user: any;
  profileFirstName?: string;
  profileDisplayName?: string;
}): string {
  const profileFirstName = String(args.profileFirstName ?? "").trim();
  if (profileFirstName) return compactTabLabel(profileFirstName);

  const profileDisplayName = String(args.profileDisplayName ?? "").trim();
  if (profileDisplayName) return compactTabLabel(profileDisplayName);

  const user = args.user;
  const metadata = user?.user_metadata ?? {};
  const metadataCandidates = [
    metadata.first_name,
    metadata.display_name,
    metadata.full_name,
    metadata.name,
  ];
  for (const candidate of metadataCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return compactTabLabel(candidate);
    }
  }

  const email = String(user?.email ?? "").trim();
  if (email.includes("@")) {
    const [local] = email.split("@");
    if (local?.trim()) return compactTabLabel(local);
  }

  return "Profile";
}

function extractAuthParams(url: string) {
  try {
    const parsed = new URL(url);
    const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
    const hashParams = new URLSearchParams(hash);

    const getParam = (key: string) => {
      const fromQuery = parsed.searchParams.get(key);
      if (fromQuery && fromQuery.trim()) return fromQuery;
      const fromHash = hashParams.get(key);
      if (fromHash && fromHash.trim()) return fromHash;
      return null;
    };

    return {
      accessToken: getParam("access_token"),
      refreshToken: getParam("refresh_token"),
      code: getParam("code"),
      tokenHash: getParam("token_hash"),
      type: getParam("type"),
      errorDescription: getParam("error_description") ?? getParam("error"),
    };
  } catch {
    return null;
  }
}

function LoadingScreen() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0B1020",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <ActivityIndicator />
    </View>
  );
}

function AuthedTabs() {
  const { theme, highContrast, user } = useAppState();
  const c = getAppColors(theme, highContrast);
  const insets = useSafeAreaInsets();
  const [profileFirstName, setProfileFirstName] = useState("");
  const [profileDisplayName, setProfileDisplayName] = useState("");
  const profileTabLabel = useMemo(
    () =>
      resolveProfileTabLabel({
        user,
        profileFirstName,
        profileDisplayName,
      }),
    [profileDisplayName, profileFirstName, user]
  );
  const tabBottomPadding = Math.max(
    insets.bottom + (Platform.OS === "android" ? 10 : 2),
    Platform.OS === "android" ? 24 : 12
  );
  const tabHeight = 62 + tabBottomPadding;

  useEffect(() => {
    let cancelled = false;
    const uid = String(user?.id ?? "").trim();
    if (!uid) {
      setProfileFirstName("");
      setProfileDisplayName("");
      return;
    }

    const loadProfileTabName = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("first_name,display_name")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      if (!error) {
        setProfileFirstName(String((data as any)?.first_name ?? ""));
        setProfileDisplayName(String((data as any)?.display_name ?? ""));
        return;
      }

      // Fallback for environments where first_name is not migrated yet.
      const { data: fallbackData, error: fallbackError } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled || fallbackError) return;
      setProfileFirstName("");
      setProfileDisplayName(String((fallbackData as any)?.display_name ?? ""));
    };

    void loadProfileTabName();

    const channel = supabase
      .channel(`tabs:profile-name:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${uid}`,
        },
        (payload) => {
          const next = (payload as any)?.new ?? null;
          if (next) {
            setProfileFirstName(String((next as any).first_name ?? ""));
            setProfileDisplayName(String((next as any).display_name ?? ""));
            return;
          }
          void loadProfileTabName();
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  const routeToContext = (routeName: string): ScreenContext => {
    if (routeName === "Events") return "group";
    if (routeName === "Solo") return "solo";
    if (routeName === "Profile") return "profile";
    return "home";
  };

  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        // Each tab gets its own contextual palette (and day/evening shift).
        ...(function () {
          const routeColors = getScreenColors(theme, highContrast, routeToContext(route.name));
          return {
            tabBarStyle: {
              backgroundColor: routeColors.card,
              borderTopColor: routeColors.border,
              borderTopWidth: 1,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              paddingHorizontal: 10,
              height: tabHeight,
              paddingTop: 8,
              paddingBottom: tabBottomPadding,
              shadowColor: "#000000",
              shadowOpacity: theme === "light" ? 0.12 : 0.32,
              shadowOffset: { width: 0, height: -2 },
              shadowRadius: 12,
              elevation: 16,
            },
            tabBarItemStyle: {
              borderRadius: 12,
              marginHorizontal: 2,
            },
            sceneStyle: {
              backgroundColor: routeColors.background,
            },
            tabBarActiveTintColor: routeColors.primary,
            tabBarInactiveTintColor: c.tabInactive,
          };
        })(),
        headerShown: false,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
        },
        tabBarHideOnKeyboard: true,
        tabBarIcon: ({ color, size, focused }) => {
          const iconSize = Math.max(20, size);
          const iconByRoute: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
            Home: focused ? "home" : "home-outline",
            Events: focused ? "account-group" : "account-group-outline",
            Solo: "hands-pray",
            Profile: focused ? "account" : "account-outline",
            Global: "earth",
            Scripts: "file-document-outline",
          };
          const routeColors = getScreenColors(theme, highContrast, routeToContext(route.name));
          return (
            <View
              style={{
                width: focused ? 34 : 30,
                height: focused ? 34 : 30,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: focused ? routeColors.cardAlt : "transparent",
                borderWidth: focused ? 1 : 0,
                borderColor: focused ? routeColors.border : "transparent",
              }}
            >
              <MaterialCommunityIcons
                name={iconByRoute[route.name] ?? "circle-outline"}
                size={focused ? iconSize + 1 : iconSize}
                color={color}
              />
            </View>
          );
        },
      })}
    >
      <Tabs.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: "Home", tabBarLabel: "Home" }}
      />
      <Tabs.Screen
        name="Events"
        component={EventsScreen}
        options={{ title: "Group Manifestation", tabBarLabel: "Group" }}
      />
      <Tabs.Screen
        name="Solo"
        component={SoloScreen}
        options={{ title: "Solo Prayer", tabBarLabel: "Solo" }}
      />
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: profileTabLabel,
          tabBarLabel: profileTabLabel,
        }}
      />

      {/* Hidden routes kept for deep-linking / internal navigation */}
      <Tabs.Screen
        name="Global"
        component={GlobalHeatMapScreen}
        options={{
          title: "Global",
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="Scripts"
        component={ScriptsScreen}
        options={{
          title: "Scripts",
          tabBarButton: () => null,
          tabBarItemStyle: { display: "none" },
        }}
      />
    </Tabs.Navigator>
  );
}

function RootNav() {
  const { user, initializing, theme, highContrast } = useAppState();
  const c = getAppColors(theme, highContrast);
  const [onboardingResolved, setOnboardingResolved] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const pendingPushEventIdRef = useRef<string | null>(null);
  const lastHandledNotificationIdRef = useRef("");
  const lastRegisteredPushUserIdRef = useRef("");
  const lastHandledAuthUrlRef = useRef("");

  useEffect(() => {
    let mounted = true;

    const handleAuthUrl = async (incomingUrl: string | null | undefined) => {
      const url = String(incomingUrl ?? "").trim();
      if (!url) return;
      if (url === lastHandledAuthUrlRef.current) return;

      const authParams = extractAuthParams(url);
      if (!authParams) return;

      const hasAuthPayload =
        !!authParams.errorDescription ||
        !!authParams.code ||
        (!!authParams.tokenHash && !!authParams.type) ||
        (!!authParams.accessToken && !!authParams.refreshToken);
      if (!hasAuthPayload) return;

      lastHandledAuthUrlRef.current = url;

      if (authParams.errorDescription) {
        Alert.alert(
          "Authentication link error",
          getAuthLinkErrorMessage(decodeMaybe(authParams.errorDescription))
        );
        return;
      }

      try {
        if (authParams.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(authParams.code);
          if (error) throw error;
          return;
        }

        if (
          authParams.tokenHash &&
          authParams.type &&
          isSupportedOtpType(authParams.type)
        ) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: authParams.tokenHash,
            type: authParams.type,
          });
          if (error) throw error;
          return;
        }

        if (authParams.accessToken && authParams.refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: authParams.accessToken,
            refresh_token: authParams.refreshToken,
          });
          if (error) throw error;
        }
      } catch (error: any) {
        Alert.alert(
          "Authentication link failed",
          getAuthLinkErrorMessage(error?.message)
        );
      }
    };

    void Linking.getInitialURL()
      .then((url) => {
        if (!mounted) return;
        void handleAuthUrl(url);
      })
      .catch(() => {
        // ignore
      });

    const sub = Linking.addEventListener("url", ({ url }) => {
      void handleAuthUrl(url);
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user) {
        if (!cancelled) {
          setOnboardingDone(false);
          setOnboardingResolved(true);
        }
        return;
      }
      try {
        const raw = await AsyncStorage.getItem(KEY_ONBOARDING_DONE);
        if (!cancelled) setOnboardingDone(raw === "1");
      } catch {
        if (!cancelled) setOnboardingDone(false);
      } finally {
        if (!cancelled) setOnboardingResolved(true);
      }
    };
    setOnboardingResolved(false);
    void run();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const completeOnboarding = useCallback(async (intention: string) => {
    setOnboardingDone(true);
    try {
      await Promise.all([
        AsyncStorage.setItem(KEY_ONBOARDING_DONE, "1"),
        AsyncStorage.setItem(KEY_DAILY_INTENTION, intention.trim() || "peace and clarity"),
      ]);
    } catch {
      // ignore
    }
  }, []);

  const openEventFromPushData = useCallback(
    (data: unknown) => {
      const eventId = extractEventIdFromNotificationData(data);
      if (!eventId) return;

      pendingPushEventIdRef.current = eventId;
      if (!user || !onboardingDone) return;
      if (!rootNavRef.isReady()) return;

      rootNavRef.navigate("EventRoom", { eventId });
      pendingPushEventIdRef.current = null;
    },
    [onboardingDone, user]
  );

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const notificationId = String(response?.notification?.request?.identifier ?? "").trim();
      if (notificationId && notificationId === lastHandledNotificationIdRef.current) return;
      if (notificationId) lastHandledNotificationIdRef.current = notificationId;
      openEventFromPushData(response?.notification?.request?.content?.data);
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        const notificationId = String(response?.notification?.request?.identifier ?? "").trim();
        if (notificationId && notificationId === lastHandledNotificationIdRef.current) return;
        if (notificationId) lastHandledNotificationIdRef.current = notificationId;
        openEventFromPushData(response?.notification?.request?.content?.data);
      })
      .catch(() => {
        // ignore
      });

    return () => {
      sub.remove();
    };
  }, [openEventFromPushData]);

  useEffect(() => {
    if (!user || !onboardingDone) return;
    const eventId = pendingPushEventIdRef.current;
    if (!eventId) return;

    const open = () => {
      if (!rootNavRef.isReady()) return false;
      rootNavRef.navigate("EventRoom", { eventId });
      pendingPushEventIdRef.current = null;
      return true;
    };

    if (open()) return;
    const timer = setTimeout(() => {
      void open();
    }, 350);
    return () => {
      clearTimeout(timer);
    };
  }, [onboardingDone, user]);

  useEffect(() => {
    const uid = user?.id ?? "";
    if (!uid) {
      lastRegisteredPushUserIdRef.current = "";
      return;
    }
    if (lastRegisteredPushUserIdRef.current === uid) return;
    lastRegisteredPushUserIdRef.current = uid;

    void registerPushTokenForCurrentUser();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void registerPushTokenForCurrentUser();
    });
    return () => {
      sub.remove();
    };
  }, [user?.id]);

  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: c.background,
        card: c.card,
        text: c.text,
        border: c.border,
        primary: c.primary,
      },
    }),
    [c]
  );

  if (initializing) {
    return <LoadingScreen />;
  }
  if (user && !onboardingResolved) {
    return <LoadingScreen />;
  }

  return (
    <NavigationContainer ref={rootNavRef} theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        {!user ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : !onboardingDone ? (
          <Stack.Screen name="Onboarding">
            {() => <OnboardingScreen onComplete={completeOnboarding} />}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="RootTabs" component={AuthedTabs} />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{
                headerShown: true,
                title: "Notifications",
                headerStyle: { backgroundColor: c.card },
                headerTintColor: c.text,
              }}
            />
            <Stack.Screen
              name="BillingDebug"
              component={BillingDebugScreen}
              options={{
                headerShown: true,
                title: "Billing Debug",
                headerStyle: { backgroundColor: c.card },
                headerTintColor: c.text,
              }}
            />
            <Stack.Screen
              name="EventRoom"
              component={EventRoomScreen}
              options={{
                headerShown: true,
                title: "Event Room",
                headerStyle: { backgroundColor: c.card },
                headerTintColor: c.text,
              }}
            />
            <Stack.Screen
              name="SoloSession"
              component={SoloSessionScreen}
              options={{
                headerShown: false,
              }}
            />
            <Stack.Screen
              name="JournalCompose"
              component={JournalComposeScreen}
              options={{
                headerShown: true,
                title: "Journal",
                headerStyle: { backgroundColor: c.card },
                headerTintColor: c.text,
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  useEffect(() => {
    ensurePushNotificationsConfigured();
  }, []);

  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <RootNav />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
