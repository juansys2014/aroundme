import "dotenv/config";
import cors from "cors";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "./config/env.js";
import { assistantRouter } from "./routes/assistant.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { memoryRouter } from "./routes/memory.js";
import { placesRouter } from "./routes/places.js";
import { profileRouter } from "./routes/profile.js";
import { providersRouter } from "./routes/providers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "../public");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/memory", memoryRouter);
app.use("/api/assistant", assistantRouter);
app.use("/api/providers", providersRouter);
app.use("/api/places", placesRouter);

app.use(express.static(publicDir));

app.listen(env.port, () => {
  console.log(`LocalGuide AI backend en http://localhost:${env.port}`);
});
