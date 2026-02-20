// mobile/App.tsx
import "react-native-gesture-handler";
import React, { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AuthScreen from "./src/screens/AuthScreen";
import HomeScreen from "./src/screens/HomeScreen";
import EventsScreen from "./src/screens/EventsScreen";
import ScriptsScreen from "./src/screens/ScriptsScreen";
import EventRoomScreen from "./src/screens/EventRoomScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

import { AppStateProvider, useAppState } from "./src/state";
import type { RootStackParamList, RootTabParamList } from "./src/types";
import type { AppTheme } from "./src/state";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<RootTabParamList>();

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

const APP_THEME_COLORS: Record<
  AppTheme,
  {
    background: string;
    card: string;
    text: string;
    border: string;
    primary: string;
    tabInactive: string;
  }
> = {
  cosmic: {
    background: "#0B1020",
    card: "#0B1020",
    text: "#FFFFFF",
    border: "#2A365E",
    primary: "#5B8CFF",
    tabInactive: "#93A3D9",
  },
  dark: {
    background: "#0A0D14",
    card: "#111827",
    text: "#F8FAFC",
    border: "#263244",
    primary: "#60A5FA",
    tabInactive: "#94A3B8",
  },
  light: {
    background: "#F5F7FB",
    card: "#FFFFFF",
    text: "#0F172A",
    border: "#D7E0F0",
    primary: "#365FD9",
    tabInactive: "#64748B",
  },
};

function AuthedTabs() {
  const { theme } = useAppState();
  const c = APP_THEME_COLORS[theme];

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
  const { user, initializing, theme } = useAppState();
  const c = APP_THEME_COLORS[theme];

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

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
        }}
      >
        {!user ? (
          <Stack.Screen name="Auth" component={AuthScreen} />
        ) : (
          <>
            <Stack.Screen name="RootTabs" component={AuthedTabs} />
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
