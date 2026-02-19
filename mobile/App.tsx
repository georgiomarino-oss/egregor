import "react-native-gesture-handler";
import React from "react";
import { Alert, Pressable, Text } from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";

import AuthScreen from "./src/screens/AuthScreen";
import EventsScreen from "./src/screens/EventsScreen";
import ScriptsScreen from "./src/screens/ScriptsScreen";
import EventRoomScreen from "./src/screens/EventRoomScreen";

import { AppStateProvider, useAppState } from "./src/state";
import type { RootStackParamList, RootTabParamList } from "./src/types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<RootTabParamList>();

function SignOutHeaderButton() {
  const { signOut } = useAppState();

  const onPress = async () => {
    try {
      await signOut();
    } catch (e: any) {
      Alert.alert("Sign out failed", e?.message ?? "Unknown error");
    }
  };

  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, paddingVertical: 6 }}>
      <Text style={{ color: "#C8D3FF", fontWeight: "800" }}>Sign out</Text>
    </Pressable>
  );
}

function AuthedTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: true,
        tabBarStyle: { backgroundColor: "#0B1020", borderTopColor: "#1F2A4A" },
        tabBarActiveTintColor: "#5B8CFF",
        tabBarInactiveTintColor: "#93A3D9",
        headerStyle: { backgroundColor: "#0B1020" },
        headerTintColor: "white",
        headerRight: () => <SignOutHeaderButton />,
      }}
    >
      <Tabs.Screen name="Events" component={EventsScreen} />
      <Tabs.Screen name="Scripts" component={ScriptsScreen} />
    </Tabs.Navigator>
  );
}

function RootNav() {
  const { user, initializing } = useAppState();

  if (initializing) return null;

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#0B1020" },
          headerTintColor: "white",
        }}
      >
        {!user ? (
          <Stack.Screen name="Auth" component={AuthScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={AuthedTabs} options={{ headerShown: false }} />
            <Stack.Screen name="EventRoom" component={EventRoomScreen} options={{ title: "Event Room" }} />
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
