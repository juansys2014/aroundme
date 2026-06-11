export type UserProfile = {
  name: string;
  language: "es" | "en";
  interests: string[];
  foodPreferences: string[];
  budget: "bajo" | "medio" | "alto";
};

/** Opciones de interés (misma lista que valida el backend). */
export const PROFILE_INTEREST_OPTIONS = [
  "comida",
  "historia",
  "naturaleza",
  "compras",
  "vida nocturna",
  "museos",
  "lugares tranquilos",
  "lugares familiares",
  "lugares económicos",
] as const;

/** Preferencias de comida (misma lista que valida el backend). */
export const PROFILE_FOOD_OPTIONS = [
  "italiana",
  "argentina",
  "mexicana",
  "japonesa",
  "vegetariana",
  "carne",
  "pescado",
  "café",
] as const;

export const PROFILE_BUDGET_OPTIONS: UserProfile["budget"][] = ["bajo", "medio", "alto"];
