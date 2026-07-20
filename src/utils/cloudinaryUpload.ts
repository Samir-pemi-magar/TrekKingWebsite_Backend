import { cloudinary } from "../config/cloudinary.js";

export type CloudinaryResourceType = "image" | "video";

export interface UploadedAsset {
  url: string;
  publicId: string;
  thumbnailUrl?: string;
}

export function uploadBufferToCloudinary(
  buffer: Buffer,
  folder: string,
  resourceType: CloudinaryResourceType
): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Cloudinary upload failed"));

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          thumbnailUrl:
            resourceType === "video"
              ? result.secure_url.replace(/\.[^/.]+$/, ".jpg")
              : undefined,
        });
      }
    );

    uploadStream.end(buffer);
  });
}

export async function uploadManyToCloudinary(
  files: Express.Multer.File[],
  folder: string,
  resourceType: CloudinaryResourceType
): Promise<UploadedAsset[]> {
  return Promise.all(files.map((file) => uploadBufferToCloudinary(file.buffer, folder, resourceType)));
}

// Best-effort delete — callers should not fail the whole request if this
// throws (e.g. asset already gone); log and move on.
export function deleteFromCloudinary(publicId: string, resourceType: CloudinaryResourceType) {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType }).catch((err) => {
    console.error(`[cloudinary] Failed to delete ${publicId}:`, err);
  });
}
