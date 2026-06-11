export type UserProfile = {
  name: string;
  language: "es" | "en";
  interests: string[];
  foodPreferences: string[];
  budget: "bajo" | "medio" | "alto";
};

export const ALLOWED_INTERESTS = new Set([
  "comida",
  "historia",
  "naturaleza",
  "compras",
  "vida nocturna",
  "museos",
  "lugares tranquilos",
  "lugares familiares",
  "lugares económicos",
]);

export const ALLOWED_FOOD = new Set([
  "italiana",
  "argentina",
  "mexicana",
  "japonesa",
  "vegetariana",
  "carne",
  "pescado",
  "café",
]);
