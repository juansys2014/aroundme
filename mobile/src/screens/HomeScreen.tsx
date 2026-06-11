import * as Location from "expo-location";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Button, StyleSheet, Text, View } from "react-native";

import type { LocationSnapshot } from "../types/location";

type Props = {
  onOpenChat: (loc: LocationSnapshot) => void;
  onOpenSettings: () => void;
  location: LocationSnapshot | null;
  locationLoading: boolean;
  locationError: string | null;
  onRetryLocation: () => void;
};

export function HomeScreen({
  onOpenChat,
  onOpenSettings,
  location,
  locationLoading,
  locationError,
  onRetryLocation,
}: Props) {
  const openedChatRef = useRef(false);

  useEffect(() => {
    if (location && !openedChatRef.current) {
      openedChatRef.current = true;
      onOpenChat(location);
    }
  }, [location, onOpenChat]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>LocalGuide AI</Text>
      <Text style={styles.subtitle}>Ajustes</Text>

      <View style={styles.row}>
        <Button title="Ajustes" onPress={onOpenSettings} />
      </View>

      {locationLoading && !location ? (
        <>
          <ActivityIndicator style={styles.spinner} />
          <Text style={styles.hint}>Detectando ubicación automáticamente...</Text>
        </>
      ) : null}

      {locationError ? (
        <>
          <Text style={styles.error}>{locationError}</Text>
          <Button title="Reintentar ubicación" onPress={onRetryLocation} />
        </>
      ) : null}

      {location ? (
        <View style={styles.block}>
          <Text style={styles.label}>GPS activo</Text>
          <Text style={styles.hint}>
            La ubicación se usa en segundo plano. Preguntá en el chat: «¿dónde estoy?»
          </Text>
          <Button title="Volver al chat" onPress={() => onOpenChat(location)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
  subtitle: {
    fontSize: 16,
    marginBottom: 8,
  },
  hint: {
    fontSize: 14,
    opacity: 0.75,
    textAlign: "center",
  },
  row: {
    alignItems: "flex-start",
  },
  spinner: {
    marginTop: 8,
  },
  error: {
    color: "#b00020",
  },
  block: {
    marginTop: 16,
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
  value: {
    fontSize: 16,
  },
  coords: {
    fontSize: 13,
    opacity: 0.7,
  },
});
