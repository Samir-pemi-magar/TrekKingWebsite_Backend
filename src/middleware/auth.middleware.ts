import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { ApiError } from "../utils/apiError.js";
import { verifyAccessToken, JwtPayload } from "../utils/jwt.js";

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

// Rejects the request if there's no valid access token.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized("Missing access token");
    req.user = verifyAccessToken(token);
    next();
  } catch {
    next(ApiError.unauthorized("Invalid or expired access token"));
  }
}

// Attaches req.user if a valid token is present, but doesn't reject
// otherwise — used for endpoints that behave differently for guests vs
// logged-in users (e.g. creating a booking).
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch {
      // ignore invalid token on optional routes
    }
  }
  next();
}

// Must be used after requireAuth.
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden("You don't have permission to do this"));
    }
    next();
  };
}
