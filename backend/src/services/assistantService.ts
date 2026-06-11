/**
 * Fachada del asistente: delega en `localGuideService` para no duplicar lógica.
 */

import type { AssistantResponse } from "../types/assistant.js";
import type { ConversationTurn, SavedPlace } from "../types/memory.js";
import type { UserProfile } from "../types/userProfile.js";
import { runAssistantPipeline } from "./localGuideService.js";

export type AskContext = {
  question: string;
  lat: number;
  lng: number;
  userProfile?: UserProfile;
  conversationHistory?: ConversationTurn[];
  savedPlaces?: SavedPlace[];
};

export type AssistantReply = AssistantResponse;

export async function buildAssistantReply(ctx: AskContext): Promise<AssistantReply> {
  return runAssistantPipeline({
    question: ctx.question,
    coordinates: { lat: ctx.lat, lng: ctx.lng },
    userProfile: ctx.userProfile,
    conversationHistory: ctx.conversationHistory,
    savedPlaces: ctx.savedPlaces,
  });
}
