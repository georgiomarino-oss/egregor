// mobile/App.tsx
import "react-native-gesture-handler";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import AuthScreen from "./src/screens/AuthScreen";
import OnboardingScreen from "./src/screens/OnboardingScreen";
import HomeScreen from "./src/screens/HomeScreen";
import GlobalHeatMapScreen from "./src/screens/GlobalHeatMapScreen";
import EventsScreen from "./src/screens/EventsScreen";
import ScriptsScreen from "./src/screens/ScriptsScreen";
import EventRoomScreen from "./src/screens/EventRoomScreen";
import ProfileScreen from "./src/screens/ProfileScreen";
import NotificationsScreen from "./src/screens/NotificationsScreen";

import { AppStateProvider, useAppState } from "./src/state";
import type { RootStackParamList, RootTabParamList } from "./src/types";
import { getAppColors } from "./src/theme/appearance";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<RootTabParamList>();
const KEY_ONBOARDING_DONE = "onboarding:done:v1";
const KEY_DAILY_INTENTION = "onboarding:intention:v1";

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
  const { theme, highContrast } = useAppState();
  const c = getAppColors(theme, highContrast);

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: true,
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.tabInactive,
        headerStyle: { backgroundColor: c.card },
        headerTintColor: c.text,
      }}
    >
      <Tabs.Screen name="Home" component={HomeScreen} />
      <Tabs.Screen name="Global" component={GlobalHeatMapScreen} options={{ title: "Global" }} />
      <Tabs.Screen name="Events" component={EventsScreen} />
      <Tabs.Screen name="Scripts" component={ScriptsScreen} />

      {/* Hidden tab route so tab screens can navigate to Profile reliably */}
      <Tabs.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          title: "Profile",
          tabBarButton: () => null, // hide from tab bar
          tabBarItemStyle: { display: "none" }, // extra-harden on Android
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
    <NavigationContainer theme={navTheme}>
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
              name="EventRoom"
              component={EventRoomScreen}
              options={{
                headerShown: true,
                title: "Event Room",
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
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <RootNav />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
