import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useLiveLocation } from "./src/hooks/useLiveLocation";
import { ChatScreen } from "./src/screens/ChatScreen";
import { HomeScreen } from "./src/screens/HomeScreen";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import { ProfileSetupScreen } from "./src/screens/ProfileSetupScreen";
import { getUserProfile, hasUserProfile } from "./src/storage/userProfileStorage";
import type { LocationSnapshot } from "./src/types/location";
import type { UserProfile } from "./src/types/userProfile";

type Screen =
  | { name: "loading" }
  | { name: "setup" }
  | { name: "home" }
  | { name: "chat" }
  | { name: "settings"; profile: UserProfile };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const locationEnabled = screen.name === "chat" || screen.name === "home";
  const { location, loading: locationLoading, error: locationError, retry } = useLiveLocation({
    enabled: locationEnabled,
  });

  const goMain = useCallback(async () => {
    const ok = await hasUserProfile();
    setScreen(ok ? { name: "chat" } : { name: "setup" });
  }, []);

  useEffect(() => {
    void goMain();
  }, [goMain]);

  async function openSettings() {
    const p = await getUserProfile();
    if (p && p.name.trim()) {
      setScreen({ name: "settings", profile: p });
    }
  }

  const chatLocation: LocationSnapshot | null = location;

  return (
    <View style={styles.root}>
      {screen.name === "loading" ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" />
        </View>
      ) : null}

      {screen.name === "setup" ? (
        <ProfileSetupScreen onComplete={() => void goMain()} />
      ) : null}

      {screen.name === "home" ? (
        <HomeScreen
          location={location}
          locationLoading={locationLoading}
          locationError={locationError}
          onRetryLocation={retry}
          onOpenChat={() => setScreen({ name: "chat" })}
          onOpenSettings={() => void openSettings()}
        />
      ) : null}

      {screen.name === "chat" ? (
        chatLocation ? (
          <ChatScreen
            location={chatLocation}
            onBack={() => void openSettings()}
          />
        ) : (
          <View style={styles.centered}>
            <ActivityIndicator size="large" />
            <Text style={styles.hint}>
              {locationError ?? "Detectando ubicación automáticamente..."}
            </Text>
            {locationError ? (
              <Text style={styles.retryLink} onPress={retry}>
                Reintentar
              </Text>
            ) : null}
          </View>
        )
      ) : null}

      {screen.name === "settings" ? (
        <SettingsScreen
          profile={screen.profile}
          onSaved={(p) => setScreen({ name: "settings", profile: p })}
          onDeleted={() => void goMain()}
          onBack={() => setScreen({ name: "chat" })}
        />
      ) : null}

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#fff",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  hint: {
    fontSize: 14,
    opacity: 0.75,
    textAlign: "center",
  },
  retryLink: {
    fontSize: 15,
    color: "#2563eb",
    marginTop: 8,
  },
});
