import { ApiError } from "./apiError.js";

export function requireStringParam(value: unknown, name = "id"): string {
  if (typeof value !== "string") {
    throw ApiError.badRequest(`Invalid ${name}`);
  }
  return value;
}
