import { v2 as cloudinary } from "cloudinary";
import { env } from "./env.js";

// All media (avatars, trip covers/galleries, post photos & videos) goes
// through Cloudinary. Imported here as `cloudinary` so callers can also use
// it directly for things like signed delete calls.
cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export { cloudinary };
