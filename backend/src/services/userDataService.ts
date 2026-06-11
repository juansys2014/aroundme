import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "../db/pool.js";
import type { ConversationTurn, SavedPlace } from "../types/memory.js";
import type { UserProfile } from "../types/userProfile.js";

const MAX_CHAT_MESSAGES = 40;
const MAX_SAVED_PLACES = 50;

type ChatRow = RowDataPacket & {
  role: "user" | "assistant";
  text: string;
  places_json: string | null;
};

type SavedRow = RowDataPacket & {
  id: number;
  place_id: string | null;
  name: string;
  address: string | null;
  lat: string | null;
  lng: string | null;
  rating: string | null;
  maps_url: string | null;
  waze_url: string | null;
  note: string | null;
  saved_at: Date;
};

function parsePlacesJson(raw: string | null): ConversationTurn["places"] {
  if (!raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : undefined;
  } catch {
    return undefined;
  }
}

function rowToSavedPlace(row: SavedRow): SavedPlace {
  const lat = row.lat != null ? Number(row.lat) : undefined;
  const lng = row.lng != null ? Number(row.lng) : undefined;
  return {
    id: row.place_id ?? String(row.id),
    name: row.name,
    address: row.address ?? undefined,
    rating: row.rating != null ? Number(row.rating) : undefined,
    location:
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? { lat, lng }
        : undefined,
    mapsUrl: row.maps_url ?? undefined,
    wazeUrl: row.waze_url ?? undefined,
    note: row.note ?? undefined,
    savedAt: row.saved_at instanceof Date ? row.saved_at.toISOString() : String(row.saved_at),
  };
}

export async function getChatMessages(userId: number): Promise<ConversationTurn[]> {
  const pool = getPool();
  const [rows] = await pool.query<ChatRow[]>(
    `SELECT role, text, places_json FROM chat_messages
     WHERE user_id = ?
     ORDER BY created_at ASC, id ASC
     LIMIT ?`,
    [userId, MAX_CHAT_MESSAGES]
  );
  return rows.map((r: ChatRow) => ({
    role: r.role,
    text: r.text,
    places: parsePlacesJson(r.places_json),
  }));
}

export async function replaceChatMessages(userId: number, messages: ConversationTurn[]): Promise<void> {
  const pool = getPool();
  const slim = messages.slice(-MAX_CHAT_MESSAGES);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM chat_messages WHERE user_id = ?", [userId]);
    for (const msg of slim) {
      const text = msg.text?.trim();
      if (!text || (msg.role !== "user" && msg.role !== "assistant")) continue;
      await conn.query(
        "INSERT INTO chat_messages (user_id, role, text, places_json) VALUES (?, ?, ?, ?)",
        [
          userId,
          msg.role,
          text,
          msg.places?.length ? JSON.stringify(msg.places) : null,
        ]
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function appendChatTurn(
  userId: number,
  userText: string,
  assistantText: string,
  places?: ConversationTurn["places"]
): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("INSERT INTO chat_messages (user_id, role, text) VALUES (?, 'user', ?)", [
      userId,
      userText.trim(),
    ]);
    await conn.query(
      "INSERT INTO chat_messages (user_id, role, text, places_json) VALUES (?, 'assistant', ?, ?)",
      [userId, assistantText.trim(), places?.length ? JSON.stringify(places) : null]
    );
    await conn.commit();
    await trimChatMessages(userId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function trimChatMessages(userId: number): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM chat_messages WHERE user_id = ?",
    [userId]
  );
  const count = Number(rows[0]?.c ?? 0);
  if (count <= MAX_CHAT_MESSAGES) return;
  const excess = count - MAX_CHAT_MESSAGES;
  await pool.query(
    "DELETE FROM chat_messages WHERE user_id = ? ORDER BY created_at ASC, id ASC LIMIT ?",
    [userId, excess]
  );
}

export async function getSavedPlaces(userId: number): Promise<SavedPlace[]> {
  const pool = getPool();
  const [rows] = await pool.query<SavedRow[]>(
    `SELECT id, place_id, name, address, lat, lng, rating, maps_url, waze_url, note, saved_at
     FROM saved_places WHERE user_id = ? ORDER BY saved_at ASC LIMIT ?`,
    [userId, MAX_SAVED_PLACES]
  );
  return rows.map(rowToSavedPlace);
}

export async function upsertSavedPlace(userId: number, place: SavedPlace): Promise<SavedPlace> {
  const name = place.name?.trim();
  if (!name) throw new Error("El lugar debe tener nombre");

  const pool = getPool();
  const lat = place.location?.lat;
  const lng = place.location?.lng;

  if (place.id && !/^\d+$/.test(place.id)) {
    const [existing] = await pool.query<SavedRow[]>(
      "SELECT id FROM saved_places WHERE user_id = ? AND place_id = ?",
      [userId, place.id]
    );
    if (existing[0]) {
      await pool.query(
        `UPDATE saved_places SET name=?, address=?, lat=?, lng=?, rating=?, maps_url=?, waze_url=?, note=?, saved_at=NOW()
         WHERE id = ? AND user_id = ?`,
        [
          name,
          place.address ?? null,
          lat ?? null,
          lng ?? null,
          place.rating ?? null,
          place.mapsUrl ?? null,
          place.wazeUrl ?? null,
          place.note ?? null,
          existing[0].id,
          userId,
        ]
      );
      const list = await getSavedPlaces(userId);
      return list.find((p) => p.id === place.id || p.name === name) ?? place;
    }
  }

  await pool.query(
    `INSERT INTO saved_places (user_id, place_id, name, address, lat, lng, rating, maps_url, waze_url, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      place.id && !/^\d+$/.test(place.id) ? place.id : null,
      name,
      place.address ?? null,
      lat ?? null,
      lng ?? null,
      place.rating ?? null,
      place.mapsUrl ?? null,
      place.wazeUrl ?? null,
      place.note ?? null,
    ]
  );

  const list = await getSavedPlaces(userId);
  return list.find((p) => p.name === name) ?? place;
}

export async function deleteSavedPlace(userId: number, placeKey: string): Promise<boolean> {
  const pool = getPool();
  const numericId = /^\d+$/.test(placeKey) ? Number(placeKey) : null;
  const [result] = await pool.query<ResultSetHeader>(
    numericId != null
      ? "DELETE FROM saved_places WHERE user_id = ? AND id = ?"
      : "DELETE FROM saved_places WHERE user_id = ? AND (place_id = ? OR name = ?)",
    numericId != null ? [userId, numericId] : [userId, placeKey, placeKey]
  );
  return result.affectedRows > 0;
}

export async function loadAssistantContext(userId: number): Promise<{
  profile: UserProfile | undefined;
  conversationHistory: ConversationTurn[];
  savedPlaces: SavedPlace[];
}> {
  const pool = getPool();
  const [profiles] = await pool.query<RowDataPacket[]>(
    "SELECT display_name, language, interests, food_preferences, budget FROM profiles WHERE user_id = ?",
    [userId]
  );
  const p = profiles[0];
  let profile: UserProfile | undefined;
  if (p) {
    const interests =
      typeof p.interests === "string" ? JSON.parse(p.interests) : (p.interests ?? []);
    const foodPreferences =
      typeof p.food_preferences === "string"
        ? JSON.parse(p.food_preferences)
        : (p.food_preferences ?? []);
    profile = {
      name: p.display_name,
      language: p.language,
      interests: Array.isArray(interests) ? interests : [],
      foodPreferences: Array.isArray(foodPreferences) ? foodPreferences : [],
      budget: p.budget,
    };
    if (!profile.name.trim()) profile = undefined;
  }

  const [history, savedPlaces] = await Promise.all([
    getChatMessages(userId),
    getSavedPlaces(userId),
  ]);

  return { profile, conversationHistory: history, savedPlaces };
}

export async function clearUserData(userId: number): Promise<void> {
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM chat_messages WHERE user_id = ?", [userId]);
    await conn.query("DELETE FROM saved_places WHERE user_id = ?", [userId]);
    await conn.query(
      `UPDATE profiles SET display_name='', interests='[]', food_preferences='[]', budget='medio' WHERE user_id = ?`,
      [userId]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
