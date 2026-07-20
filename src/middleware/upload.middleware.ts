import multer from "multer";

// All uploads land in memory as Buffers, then get streamed to Cloudinary
// (see utils/cloudinaryUpload.ts) — nothing is ever written to local disk.
const storage = multer.memoryStorage();

const imageLimits = { fileSize: 8 * 1024 * 1024 }; // 8MB per image
const videoLimits = { fileSize: 100 * 1024 * 1024 }; // 100MB per video

export const uploadAvatar = multer({ storage, limits: imageLimits }).single("avatar");

export const uploadTripCover = multer({ storage, limits: imageLimits }).single("coverImage");

export const uploadTripPhotos = multer({ storage, limits: imageLimits }).array("photos", 20);

export const uploadTripVideos = multer({ storage, limits: videoLimits }).array("videos", 10);

export const uploadPostMedia = multer({ storage, limits: videoLimits }).fields([
  { name: "photos", maxCount: 20 },
  { name: "videos", maxCount: 10 },
]);

// Homepage hero image + About page hero image, editable by admins from
// AboutPage.tsx / HomePage.tsx. Both optional and independent — an admin
// might replace just one at a time.
export const uploadSiteContentImages = multer({ storage, limits: imageLimits }).fields([
  { name: "homeHeroImage", maxCount: 1 },
  { name: "aboutHeroImage", maxCount: 1 },
]);