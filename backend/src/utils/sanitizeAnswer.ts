const COORD_PAIR = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;
const COORD_PARENS = /\(\s*-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\s*\)/g;

/** Quita coordenadas GPS del texto mostrado al usuario (salvo respuestas de ubicación explícita). */
export function sanitizeAnswerForDisplay(text: string, allowCoordinates = false): string {
  if (allowCoordinates) return text.trim();

  let out = text
    .replace(COORD_PARENS, "")
    .replace(COORD_PAIR, "")
    .replace(/coordenadas?\s+recibidas?/gi, "")
    .replace(/coordinates?\s+received/gi, "")
    .replace(/según tu ubicación actual,?\s*/gi, "")
    .replace(/based on your current location,?\s*/gi, "");

  return out.replace(/\s{2,}/g, " ").trim();
}
