// mobile/App.tsx
import "react-native-gesture-handler";
import React, { useMemo } from "react";
import { ActivityIndicator, View } from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AuthScreen from "./src/screens/AuthScreen";
import EventsScreen from "./src/screens/EventsScreen";
import ScriptsScreen from "./src/screens/ScriptsScreen";
import EventRoomScreen from "./src/screens/EventRoomScreen";
import ProfileScreen from "./src/screens/ProfileScreen";

import { AppStateProvider, useAppState } from "./src/state";
import type { RootStackParamList, RootTabParamList } from "./src/types";

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

function AuthedTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: true,
        tabBarStyle: { backgroundColor: "#0B1020" },
        tabBarActiveTintColor: "#FFFFFF",
        tabBarInactiveTintColor: "#93A3D9",
      }}
    >
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
  const { user, initializing } = useAppState();

  const navTheme = useMemo(
    () => ({
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        background: "#0B1020",
        card: "#0B1020",
        text: "#FFFFFF",
        border: "#2A365E",
        primary: "#5B8CFF",
      },
    }),
    []
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
              options={{ headerShown: true, title: "Event Room" }}
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
