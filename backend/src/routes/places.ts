import { Router } from "express";

import { env } from "../config/env.js";

export const placesRouter = Router();

const PHOTO_TIMEOUT_MS = 8000;

placesRouter.get("/photo", async (req, res) => {
  const ref = req.query.ref;
  if (typeof ref !== "string" || !ref.startsWith("places/") || !env.googlePlacesApiKey) {
    res.status(400).json({ error: "ref de foto inválido o Google Places no configurado" });
    return;
  }

  const mediaUrl = `https://places.googleapis.com/v1/${ref}/media?maxHeightPx=480&maxWidthPx=640&key=${env.googlePlacesApiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);

  try {
    const imgRes = await fetch(mediaUrl, { redirect: "follow", signal: controller.signal });
    if (!imgRes.ok) {
      res.status(502).json({ error: "No se pudo obtener la foto del lugar" });
      return;
    }

    const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    const buf = Buffer.from(await imgRes.arrayBuffer());
    res.send(buf);
  } catch {
    res.status(502).json({ error: "Error al cargar la foto" });
  } finally {
    clearTimeout(timer);
  }
});
