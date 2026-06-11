import { useState } from "react";
import {
  Alert,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { clearUserProfile, saveUserProfile } from "../storage/userProfileStorage";
import {
  PROFILE_BUDGET_OPTIONS,
  PROFILE_FOOD_OPTIONS,
  PROFILE_INTEREST_OPTIONS,
  type UserProfile,
} from "../types/userProfile";

type Props = {
  profile: UserProfile;
  onSaved: (profile: UserProfile) => void;
  onDeleted: () => void;
  onBack: () => void;
};

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function SettingsScreen({ profile, onSaved, onDeleted, onBack }: Props) {
  const [name, setName] = useState(profile.name);
  const [language, setLanguage] = useState<UserProfile["language"]>(profile.language);
  const [interests, setInterests] = useState<string[]>(profile.interests);
  const [foodPreferences, setFoodPreferences] = useState<string[]>(profile.foodPreferences);
  const [budget, setBudget] = useState<UserProfile["budget"]>(profile.budget);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("El nombre no puede estar vacío.");
      return;
    }
    setError(null);
    const next: UserProfile = {
      name: trimmed,
      language,
      interests,
      foodPreferences,
      budget,
    };
    await saveUserProfile(next);
    onSaved(next);
  }

  function confirmDelete() {
    Alert.alert(
      "Borrar perfil",
      "Se eliminarán nombre y preferencias de este dispositivo. ¿Continuar?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Borrar",
          style: "destructive",
          onPress: () => void handleDelete(),
        },
      ]
    );
  }

  async function handleDelete() {
    await clearUserProfile();
    onDeleted();
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.headerRow}>
        <Button title="Volver al chat" onPress={onBack} />
      </View>

      <Text style={styles.title}>Ajustes</Text>
      <Text style={styles.hint}>Perfil y preferencias del asistente.</Text>

      <Text style={styles.section}>Tu perfil</Text>

      <Text style={styles.label}>Nombre</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Nombre"
        autoCapitalize="words"
      />

      <Text style={styles.label}>Idioma de respuestas</Text>
      <View style={styles.row}>
        {(["es", "en"] as const).map((lang) => (
          <Pressable
            key={lang}
            style={[styles.chip, language === lang && styles.chipOn]}
            onPress={() => setLanguage(lang)}
          >
            <Text style={styles.chipText}>{lang === "es" ? "Español" : "English"}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Intereses</Text>
      <View style={styles.wrap}>
        {PROFILE_INTEREST_OPTIONS.map((opt) => (
          <Pressable
            key={opt}
            style={[styles.chip, interests.includes(opt) && styles.chipOn]}
            onPress={() => setInterests((prev) => toggleInList(prev, opt))}
          >
            <Text style={styles.chipText}>{opt}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Preferencias de comida</Text>
      <View style={styles.wrap}>
        {PROFILE_FOOD_OPTIONS.map((opt) => (
          <Pressable
            key={opt}
            style={[styles.chip, foodPreferences.includes(opt) && styles.chipOn]}
            onPress={() => setFoodPreferences((prev) => toggleInList(prev, opt))}
          >
            <Text style={styles.chipText}>{opt}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Presupuesto</Text>
      <View style={styles.row}>
        {PROFILE_BUDGET_OPTIONS.map((b) => (
          <Pressable
            key={b}
            style={[styles.chip, budget === b && styles.chipOn]}
            onPress={() => setBudget(b)}
          >
            <Text style={styles.chipText}>{b}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.section}>Ubicación</Text>
      <Text style={styles.hint}>
        El GPS funciona en segundo plano. Preguntá «¿dónde estoy?» en el chat para saber el nombre del
        lugar.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        <Button title="Guardar ajustes" onPress={() => void handleSave()} />
        <View style={styles.spacer} />
        <Button title="Borrar perfil local" color="#b00020" onPress={confirmDelete} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 24,
    paddingBottom: 48,
    gap: 8,
  },
  headerRow: {
    alignItems: "flex-start",
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginTop: 8,
  },
  section: {
    fontSize: 16,
    fontWeight: "600",
    marginTop: 16,
  },
  hint: {
    fontSize: 14,
    opacity: 0.75,
    marginBottom: 8,
  },
  label: {
    fontSize: 15,
    fontWeight: "500",
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 16,
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  wrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ccc",
    backgroundColor: "#fafafa",
  },
  chipOn: {
    borderColor: "#1976d2",
    backgroundColor: "#e3f2fd",
  },
  chipText: {
    fontSize: 14,
  },
  error: {
    color: "#b00020",
    marginTop: 8,
  },
  actions: {
    marginTop: 20,
    gap: 8,
  },
  spacer: {
    height: 8,
  },
});
