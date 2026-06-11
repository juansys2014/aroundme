import { useState } from "react";
import {
  Button,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { askAssistant, resolveAssetUrl, type PlaceResult } from "../services/api";
import { getUserProfile } from "../storage/userProfileStorage";
import type { LocationSnapshot } from "../types/location";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  simulated?: boolean;
  sources?: string[];
  places?: PlaceResult[];
};

function PlaceCards({ places }: { places: PlaceResult[] }) {
  return (
    <View style={styles.placeCards}>
      {places.map((p, i) => (
        <View key={p.id ?? `${p.name}-${i}`} style={styles.placeCard}>
          {p.photoUrl ? (
            <Image source={{ uri: resolveAssetUrl(p.photoUrl) }} style={styles.placePhoto} />
          ) : null}
          <Text style={styles.placeName}>{p.name}</Text>
          {p.rating != null ? (
            <Text style={styles.placeMeta}>
              ⭐ {p.rating}
              {p.userRatingsTotal != null ? ` (${p.userRatingsTotal})` : ""}
            </Text>
          ) : null}
          {p.address ? <Text style={styles.placeMeta}>{p.address}</Text> : null}
          <View style={styles.placeActions}>
            {p.mapsUrl ? (
              <Pressable style={styles.linkBtn} onPress={() => void Linking.openURL(p.mapsUrl!)}>
                <Text style={styles.linkBtnText}>Google Maps</Text>
              </Pressable>
            ) : null}
            {p.wazeUrl ? (
              <Pressable style={styles.linkBtn} onPress={() => void Linking.openURL(p.wazeUrl!)}>
                <Text style={styles.linkBtnText}>Waze</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

type Props = {
  location: LocationSnapshot;
  onBack: () => void;
};

export function ChatScreen({ location, onBack }: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  async function send() {
    const question = input.trim();
    if (!question || sending) return;

    const userMsg: ChatMessage = {
      id: `${Date.now()}-u`,
      role: "user",
      text: question,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setSending(true);

    try {
      const stored = await getUserProfile();
      const userProfile =
        stored && stored.name.trim().length > 0 ? stored : undefined;

      const reply = await askAssistant({
        question,
        lat: location.lat,
        lng: location.lng,
        userProfile,
      });
      const assistantMsg: ChatMessage = {
        id: `${Date.now()}-a`,
        role: "assistant",
        text: reply.answer,
        simulated: reply.simulated,
        sources: reply.sources,
        places: reply.places,
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch (e) {
      const text = e instanceof Error ? e.message : "Error al contactar al servidor.";
      setMessages((m) => [...m, { id: `${Date.now()}-e`, role: "assistant", text }]);
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={64}
    >
      <View style={styles.header}>
        <Button title="Ajustes" onPress={onBack} />
        <Text style={styles.headerText} numberOfLines={2}>
          Listo · ubicación en segundo plano
        </Text>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text style={styles.bubbleLabel}>{item.role === "user" ? "Tú" : "Asistente"}</Text>
            {item.role === "assistant" && item.simulated ? (
              <Text style={styles.simulatedBadge}>Respuesta simulada (sin datos reales verificados)</Text>
            ) : null}
            <Text style={styles.bubbleText}>{item.text}</Text>
            {item.role === "assistant" && item.places && item.places.length > 0 ? (
              <PlaceCards places={item.places} />
            ) : null}
            {item.role === "assistant" && item.sources && item.sources.length > 0 ? (
              <Text style={styles.sourcesText}>Fuentes: {item.sources.join(", ")}</Text>
            ) : null}
          </View>
        )}
      />

      <View style={styles.row}>
        <TextInput
          style={styles.input}
          placeholder="Escribí tu pregunta"
          value={input}
          onChangeText={setInput}
          editable={!sending}
          onSubmitEditing={send}
        />
        <Button title="Enviar" onPress={send} disabled={sending || !input.trim()} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 4,
  },
  headerText: {
    fontSize: 14,
    paddingHorizontal: 8,
  },
  list: {
    padding: 12,
    gap: 8,
  },
  bubble: {
    padding: 10,
    borderRadius: 8,
    maxWidth: "92%",
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: "#e3f2fd",
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: "#f5f5f5",
  },
  bubbleLabel: {
    fontSize: 12,
    marginBottom: 4,
    opacity: 0.7,
  },
  bubbleText: {
    fontSize: 15,
  },
  simulatedBadge: {
    fontSize: 11,
    color: "#8a6d00",
    marginBottom: 4,
    fontStyle: "italic",
  },
  sourcesText: {
    fontSize: 11,
    marginTop: 6,
    opacity: 0.65,
  },
  placeCards: {
    marginTop: 8,
    gap: 8,
  },
  placeCard: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  placePhoto: {
    width: "100%",
    height: 120,
    backgroundColor: "#f1f5f9",
  },
  placeName: {
    fontSize: 14,
    fontWeight: "600",
    paddingHorizontal: 8,
    paddingTop: 6,
  },
  placeMeta: {
    fontSize: 12,
    color: "#64748b",
    paddingHorizontal: 8,
    paddingTop: 2,
  },
  placeActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    padding: 8,
  },
  linkBtn: {
    backgroundColor: "#e2e8f0",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  linkBtnText: {
    fontSize: 12,
    color: "#0f172a",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#ccc",
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
  },
});
