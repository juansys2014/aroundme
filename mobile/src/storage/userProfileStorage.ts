import AsyncStorage from "@react-native-async-storage/async-storage";

import type { UserProfile } from "../types/userProfile";

const STORAGE_KEY = "LOCALGUIDE_USER_PROFILE";

export async function getUserProfile(): Promise<UserProfile | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as UserProfile;
    if (!parsed || typeof parsed.name !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveUserProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export async function clearUserProfile(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function hasUserProfile(): Promise<boolean> {
  const p = await getUserProfile();
  return p !== null && p.name.trim().length > 0;
}
