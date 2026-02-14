import React, { useContext } from "react";
import {
  View,
  Text,
  Button,
  StyleSheet,
  TextInput,
  ScrollView
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppStateContext } from "../state";
import type { RootStackParamList, EventItem } from "../types";

type Props = NativeStackScreenProps<RootStackParamList, "Events">;

export default function EventsScreen({ navigation }: Props) {
  const s = useContext(AppStateContext);
  if (!s) return null;

  const selectedEvent =
    s.events.find((ev) => ev.id === s.selectedEventId) ?? null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {/* 2) Create Event */}
      <View style={styles.section}>
        <Text style={styles.title}>2) Create Event</Text>

        <TextInput
          style={styles.input}
          value={s.newTitle}
          onChangeText={s.setNewTitle}
          placeholder="Event title"
        />

        <TextInput
          style={[styles.input, styles.multi]}
          value={s.newIntention}
          onChangeText={s.setNewIntention}
          placeholder="Intention statement"
          multiline
        />

        <TextInput
          style={[styles.input, styles.multi]}
          value={s.newDescription}
          onChangeText={s.setNewDescription}
          placeholder="Description (optional)"
          multiline
        />

        <TextInput
          style={styles.input}
          value={s.newStartLocal}
          onChangeText={s.setNewStartLocal}
          placeholder="Start local (YYYY-MM-DDTHH:mm)"
        />

        <TextInput
          style={styles.input}
          value={s.newEndLocal}
          onChangeText={s.setNewEndLocal}
          placeholder="End local (YYYY-MM-DDTHH:mm)"
        />

        <TextInput
          style={styles.input}
          value={s.newTimezone}
          onChangeText={s.setNewTimezone}
          placeholder="Timezone (e.g. Europe/London)"
        />

        <Button
          title="Create event"
          onPress={s.handleCreateEvent}
          disabled={!s.token}
        />

        {!!s.createEventStatus && (
          <Text
            style={
              s.createEventStatus.startsWith("❌") ? styles.error : styles.ok
            }
          >
            {s.createEventStatus}
          </Text>
        )}
      </View>

      {/* 3) Events */}
      <View style={styles.section}>
        <Text style={styles.title}>3) Events</Text>

        <Button title="Refresh events" onPress={s.loadEvents} />
        {!!s.eventsError && <Text style={styles.error}>{s.eventsError}</Text>}

        {s.events.length === 0 ? (
          <Text style={styles.empty}>No events yet.</Text>
        ) : (
          <View style={{ marginTop: 10 }}>
            {s.events.map((item: EventItem) => {
              const isSelected = item.id === s.selectedEventId;
              return (
                <View
                  key={item.id}
                  style={[
                    styles.eventCard,
                    isSelected ? styles.eventCardSelected : null
                  ]}
                >
                  <Text style={styles.eventTitle}>{item.title}</Text>
                  <Text>{item.intentionStatement}</Text>
                  <Text>Active now: {item.activeNow ?? 0}</Text>
                  <Text>Total joined: {item.totalJoinCount ?? 0}</Text>
                  <Text>
                    {new Date(item.startTimeUtc).toLocaleString()} →{" "}
                    {new Date(item.endTimeUtc).toLocaleString()} ({item.timezone})
                  </Text>
                  <Text>Attached script: {item.scriptId || "(none)"}</Text>

                  <View style={{ height: 8 }} />
                  <Button
                    title={isSelected ? "Selected" : "Select this event"}
                    onPress={() => s.setSelectedEventId(item.id)}
                    disabled={isSelected}
                  />
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.row}>
          <Button
            title="Join live"
            onPress={s.handleJoinLive}
            disabled={!s.token || !s.selectedEventId || s.isJoined}
          />
          <View style={{ width: 10 }} />
          <Button
            title="Leave live"
            onPress={s.handleLeaveLive}
            disabled={!s.token || !s.selectedEventId || !s.isJoined}
          />
        </View>

        {!!s.presenceStatus && <Text style={styles.ok}>{s.presenceStatus}</Text>}
        {!!s.presenceError && <Text style={styles.error}>{s.presenceError}</Text>}

        {selectedEvent ? (
          <Text style={styles.selectedText}>
            Selected: {selectedEvent.title}
          </Text>
        ) : (
          <Text style={styles.selectedText}>No event selected.</Text>
        )}

        <View style={{ height: 10 }} />
        <Button
          title="Go to Scripts"
          onPress={() => navigation.navigate("Scripts")}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, paddingBottom: 30 },
  section: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 10,
    padding: 12,
    marginBottom: 14
  },
  title: { fontSize: 22, fontWeight: "700", marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 8
  },
  multi: { minHeight: 72, textAlignVertical: "top" },
  row: { flexDirection: "row", alignItems: "center", marginTop: 10 },
  eventCard: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10
  },
  eventCardSelected: {
    borderColor: "#4a90e2",
    borderWidth: 2
  },
  eventTitle: { fontSize: 18, fontWeight: "700" },
  selectedText: { marginTop: 8, fontWeight: "600" },
  empty: { marginTop: 10, color: "#666" },
  ok: { color: "green", marginTop: 8 },
  error: { color: "crimson", marginTop: 8 }
});
