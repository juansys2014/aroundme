import { Router } from "express";
import { isDatabaseEnabled } from "../db/pool.js";
import { requireAuth } from "../middleware/auth.js";
import { getUserById, loginUser, registerUser } from "../services/authService.js";

export const authRouter = Router();

authRouter.get("/status", (_req, res) => {
  res.json({
    database: isDatabaseEnabled(),
    authRequired: isDatabaseEnabled(),
  });
});

authRouter.post("/register", async (req, res) => {
  if (!isDatabaseEnabled()) {
    res.status(503).json({ error: "Base de datos no configurada en el servidor" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName =
    typeof body.displayName === "string"
      ? body.displayName
      : typeof body.name === "string"
        ? body.name
        : "";

  try {
    const result = await registerUser({ email, password, displayName });
    res.status(201).json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "No se pudo registrar";
    const status = message.includes("Ya existe") ? 409 : 400;
    res.status(status).json({ error: message });
  }
});

authRouter.post("/login", async (req, res) => {
  if (!isDatabaseEnabled()) {
    res.status(503).json({ error: "Base de datos no configurada en el servidor" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const email = typeof body.email === "string" ? body.email : "";
  const password = typeof body.password === "string" ? body.password : "";

  try {
    const result = await loginUser(email, password);
    res.json(result);
  } catch {
    res.status(401).json({ error: "Email o contraseña incorrectos" });
  }
});

authRouter.get("/me", requireAuth, async (req, res) => {
  try {
    const data = await getUserById(req.auth!.userId);
    res.json({ email: data.email, profile: data.profile });
  } catch {
    res.status(404).json({ error: "Usuario no encontrado" });
  }
});
