import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { isDatabaseEnabled } from "../db/pool.js";

export type AuthPayload = {
  userId: number;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

function parseBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export function verifyToken(token: string): AuthPayload | null {
  if (!env.jwtSecret) return null;
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    const userId = Number(decoded.sub);
    const email = typeof decoded.email === "string" ? decoded.email : "";
    if (!Number.isFinite(userId) || userId <= 0 || !email) return null;
    return { userId, email };
  } catch {
    return null;
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = parseBearerToken(req);
  if (token) {
    const auth = verifyToken(token);
    if (auth) req.auth = auth;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = parseBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Iniciá sesión para continuar" });
    return;
  }
  const auth = verifyToken(token);
  if (!auth) {
    res.status(401).json({ error: "Sesión inválida o expirada" });
    return;
  }
  req.auth = auth;
  next();
}

export function requireAuthIfDb(req: Request, res: Response, next: NextFunction): void {
  if (!isDatabaseEnabled()) {
    next();
    return;
  }
  requireAuth(req, res, next);
}
