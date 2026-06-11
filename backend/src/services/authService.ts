import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { env } from "../config/env.js";
import { getPool } from "../db/pool.js";
import type { UserProfile } from "../types/userProfile.js";
import { ALLOWED_FOOD, ALLOWED_INTERESTS } from "../types/userProfile.js";

const BCRYPT_ROUNDS = 10;
const JWT_EXPIRES = "30d";

type UserRow = RowDataPacket & {
  id: number;
  email: string;
  password_hash: string;
};

type ProfileRow = RowDataPacket & {
  display_name: string;
  language: "es" | "en";
  interests: string;
  food_preferences: string;
  budget: "bajo" | "medio" | "alto";
};

function signToken(userId: number, email: string): string {
  if (!env.jwtSecret) throw new Error("JWT_SECRET no configurado");
  return jwt.sign({ email }, env.jwtSecret, { subject: String(userId), expiresIn: JWT_EXPIRES });
}

function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function rowToProfile(row: ProfileRow): UserProfile {
  return {
    name: row.display_name,
    language: row.language,
    interests: parseJsonArray(row.interests),
    foodPreferences: parseJsonArray(row.food_preferences),
    budget: row.budget,
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
}): Promise<{ token: string; email: string; profile: UserProfile }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  const displayName = input.displayName.trim();

  if (!isValidEmail(email)) throw new Error("Email inválido");
  if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");
  if (!displayName) throw new Error("El nombre es obligatorio");

  const pool = getPool();
  const [existing] = await pool.query<UserRow[]>("SELECT id FROM users WHERE email = ?", [email]);
  if (existing.length > 0) throw new Error("Ya existe una cuenta con ese email");

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [userResult] = await conn.query<ResultSetHeader>(
      "INSERT INTO users (email, password_hash) VALUES (?, ?)",
      [email, passwordHash]
    );
    const userId = userResult.insertId;
    await conn.query(
      `INSERT INTO profiles (user_id, display_name, language, interests, food_preferences, budget)
       VALUES (?, ?, 'es', '[]', '[]', 'medio')`,
      [userId, displayName]
    );
    await conn.commit();

    const profile: UserProfile = {
      name: displayName,
      language: "es",
      interests: [],
      foodPreferences: [],
      budget: "medio",
    };
    return { token: signToken(userId, email), email, profile };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function loginUser(
  emailRaw: string,
  password: string
): Promise<{ token: string; email: string; profile: UserProfile | null }> {
  const email = emailRaw.trim().toLowerCase();
  if (!isValidEmail(email)) throw new Error("Email o contraseña incorrectos");

  const pool = getPool();
  const [users] = await pool.query<UserRow[]>(
    "SELECT id, email, password_hash FROM users WHERE email = ?",
    [email]
  );
  const user = users[0];
  if (!user) throw new Error("Email o contraseña incorrectos");

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new Error("Email o contraseña incorrectos");

  const [profiles] = await pool.query<ProfileRow[]>(
    "SELECT display_name, language, interests, food_preferences, budget FROM profiles WHERE user_id = ?",
    [user.id]
  );
  const profile = profiles[0] ? rowToProfile(profiles[0]) : null;
  return { token: signToken(user.id, user.email), email: user.email, profile };
}

export async function getUserById(userId: number): Promise<{ email: string; profile: UserProfile | null }> {
  const pool = getPool();
  const [users] = await pool.query<UserRow[]>("SELECT email FROM users WHERE id = ?", [userId]);
  const user = users[0];
  if (!user) throw new Error("Usuario no encontrado");

  const [profiles] = await pool.query<ProfileRow[]>(
    "SELECT display_name, language, interests, food_preferences, budget FROM profiles WHERE user_id = ?",
    [userId]
  );
  return { email: user.email, profile: profiles[0] ? rowToProfile(profiles[0]) : null };
}

export function validateProfileInput(profile: UserProfile): UserProfile {
  const name = profile.name.trim();
  if (!name) throw new Error("El nombre es obligatorio");
  if (profile.language !== "es" && profile.language !== "en") {
    throw new Error("Idioma inválido");
  }
  for (const item of profile.interests) {
    if (!ALLOWED_INTERESTS.has(item)) throw new Error("Interés no permitido");
  }
  for (const item of profile.foodPreferences) {
    if (!ALLOWED_FOOD.has(item)) throw new Error("Preferencia de comida no permitida");
  }
  if (!["bajo", "medio", "alto"].includes(profile.budget)) {
    throw new Error("Presupuesto inválido");
  }
  return { ...profile, name };
}

export async function upsertProfile(userId: number, profile: UserProfile): Promise<UserProfile> {
  const valid = validateProfileInput(profile);
  const pool = getPool();
  await pool.query(
    `INSERT INTO profiles (user_id, display_name, language, interests, food_preferences, budget)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       language = VALUES(language),
       interests = VALUES(interests),
       food_preferences = VALUES(food_preferences),
       budget = VALUES(budget)`,
    [
      userId,
      valid.name,
      valid.language,
      JSON.stringify(valid.interests),
      JSON.stringify(valid.foodPreferences),
      valid.budget,
    ]
  );
  return valid;
}
