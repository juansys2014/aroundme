import { useState } from "react";
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { saveUserProfile } from "../storage/userProfileStorage";
import {
  PROFILE_BUDGET_OPTIONS,
  PROFILE_FOOD_OPTIONS,
  PROFILE_INTEREST_OPTIONS,
  type UserProfile,
} from "../types/userProfile";

type Props = {
  onComplete: () => void;
};

function toggleInList(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function ProfileSetupScreen({ onComplete }: Props) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState<UserProfile["language"]>("es");
  const [interests, setInterests] = useState<string[]>([]);
  const [foodPreferences, setFoodPreferences] = useState<string[]>([]);
  const [budget, setBudget] = useState<UserProfile["budget"]>("medio");
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Ingresá tu nombre para continuar.");
      return;
    }
    setError(null);
    const profile: UserProfile = {
      name: trimmed,
      language,
      interests,
      foodPreferences,
      budget,
    };
    await saveUserProfile(profile);
    onComplete();
  }

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Configurá tu perfil</Text>
      <Text style={styles.hint}>Sin cuenta: los datos se guardan solo en este dispositivo.</Text>

      <Text style={styles.label}>Nombre</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="Cómo te llamamos"
        autoCapitalize="words"
      />

      <Text style={styles.label}>Idioma</Text>
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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button title="Guardar y continuar" onPress={() => void handleSave()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: 24,
    paddingBottom: 48,
    gap: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
    marginBottom: 4,
  },
  hint: {
    fontSize: 14,
    opacity: 0.75,
    marginBottom: 12,
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
});
