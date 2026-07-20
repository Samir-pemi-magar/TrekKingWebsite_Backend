import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Optional — only needed if you use Supabase Storage in addition to Postgres.
// New uploads go through Cloudinary (see cloudinary.ts).
export const supabase =
  env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

export const TRIP_IMAGE_BUCKET = "trip-images";
