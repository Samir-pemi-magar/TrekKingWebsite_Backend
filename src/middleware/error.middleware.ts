import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { MulterError } from "multer";
import { ApiError } from "../utils/apiError.js";

export function notFoundMiddleware(req: Request, res: Response) {
  res.status(404).json({ status: "error", message: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({ status: "error", message: err.message, details: err.details });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({ status: "error", message: "Validation failed", details: err.flatten() });
  }

  if (err instanceof MulterError) {
    const message =
      err.code === "LIMIT_UNEXPECTED_FILE"
        ? `Unexpected file field "${err.field}" — check the upload form's field name`
        : err.code === "LIMIT_FILE_SIZE"
          ? "File is too large"
          : err.message;
    return res.status(400).json({ status: "error", message, code: err.code });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") {
      return res.status(404).json({ status: "error", message: "Record not found" });
    }
    if (err.code === "P2002") {
      return res.status(409).json({ status: "error", message: "A record with these details already exists" });
    }
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ status: "error", message: "Something went wrong" });
}