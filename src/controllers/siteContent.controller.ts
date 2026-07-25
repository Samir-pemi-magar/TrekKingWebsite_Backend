import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import * as SiteContentModel from "../models/siteContent.model.js";
import { uploadBufferToCloudinary, deleteFromCloudinary } from "../utils/cloudinaryUpload.js";

// Same reasoning/pattern as `stringArrayField` in trip.controller.ts: the
// create/update route goes through multer (uploadSiteContentImages) because
// it accepts optional image files, so the request is multipart/form-data —
// every field, including objects/arrays, arrives in req.body as a plain
// string. The frontend JSON.stringifies aboutFeatures before appending it
// to FormData, so this preprocessor parses it back before validation.
const featureSchema = z.object({
  title: z.string().min(1).max(80),
  description: z.string().min(1).max(300),
});

const aboutFeaturesField = z.preprocess((val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON — fall through and let the array schema below reject it.
    }
  }
  return val;
}, z.array(featureSchema).max(6).optional());

// Same multipart-stringify-then-parse reasoning as aboutFeaturesField above.
function jsonArrayPreprocessor(val: unknown) {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // Not JSON — fall through and let the array schema below reject it.
    }
  }
  return val;
}

const statSchema = z.object({
  value: z.string().min(1).max(20), // e.g. "15+", "2,400+", "100%"
  label: z.string().min(1).max(100), // e.g. "Years operating in Nepal"
});

const homeStatsField = z.preprocess(jsonArrayPreprocessor, z.array(statSchema).max(8).optional());

// Platform is free text (not an enum) — admin can label a link however they
// like; the frontend matches known names (facebook/instagram/etc.) to a
// branded icon and falls back to a generic link icon for anything else.
const socialLinkSchema = z.object({
  platform: z.string().min(1).max(40),
  url: z.string().url().max(500),
});

const socialLinksField = z.preprocess(jsonArrayPreprocessor, z.array(socialLinkSchema).max(12).optional());

const updateSchema = z.object({
  siteName: z.string().min(1).max(80).optional(),

  homeHeroEyebrow: z.string().max(200).optional(),
  homeHeroTitle: z.string().max(200).optional(),
  homeHeroSubtitle: z.string().max(500).optional(),
  homeStats: homeStatsField,

  aboutIntro: z.string().max(2000).optional(),
  aboutBody: z.string().max(5000).optional(),
  aboutClosing: z.string().max(2000).optional(),
  aboutFeatures: aboutFeaturesField,

  footerTagline: z.string().max(300).optional(),
  footerPhone: z.string().max(30).optional(),
  footerEmail: z.string().email().max(200).optional(),
  footerAddress: z.string().max(300).optional(),

  contactAddress: z.string().max(300).optional(),
  contactPhone: z.string().max(30).optional(),
  contactEmail: z.string().email().max(200).optional(),
  contactResponseNote: z.string().max(500).optional(),

  socialLinks: socialLinksField,
});

// Public — powers the About page and Homepage hero for every visitor.
export async function getSiteContent(_req: Request, res: Response, next: NextFunction) {
  try {
    const content = await SiteContentModel.getSiteContent();
    res.json({ status: "success", data: content });
  } catch (err) {
    next(err);
  }
}

// Admin-only (see requireRole(Role.ADMIN) on the route). Multipart: any
// subset of the text fields above, plus optional homeHeroImage /
// aboutHeroImage / authLoginImage / authSignupImage files (see
// upload.middleware.ts -> uploadSiteContentImages — that multer config
// needs a matching .fields([...]) entry for authLoginImage/authSignupImage
// or these will silently be dropped by multer before req.files ever sees
// them). Only fields actually sent are changed — a partial update, same as
// PATCH /trips/:id.
export async function updateSiteContent(req: Request, res: Response, next: NextFunction) {
  try {
    const data = updateSchema.parse(req.body);
    const files = req.files as
      | {
          homeHeroImage?: Express.Multer.File[];
          aboutHeroImage?: Express.Multer.File[];
          authLoginImage?: Express.Multer.File[];
          authSignupImage?: Express.Multer.File[];
        }
      | undefined;

    const existing = await SiteContentModel.getSiteContent();
    const updates: Record<string, unknown> = { ...data };

    const homeHeroFile = files?.homeHeroImage?.[0];
    if (homeHeroFile) {
      const uploaded = await uploadBufferToCloudinary(homeHeroFile.buffer, "site/home-hero", "image");
      if (existing.homeHeroPublicId) {
        await deleteFromCloudinary(existing.homeHeroPublicId, "image");
      }
      updates.homeHeroImageUrl = uploaded.url;
      updates.homeHeroPublicId = uploaded.publicId;
    }

    const aboutHeroFile = files?.aboutHeroImage?.[0];
    if (aboutHeroFile) {
      const uploaded = await uploadBufferToCloudinary(aboutHeroFile.buffer, "site/about-hero", "image");
      if (existing.aboutHeroPublicId) {
        await deleteFromCloudinary(existing.aboutHeroPublicId, "image");
      }
      updates.aboutHeroImageUrl = uploaded.url;
      updates.aboutHeroPublicId = uploaded.publicId;
    }

    const authLoginFile = files?.authLoginImage?.[0];
    if (authLoginFile) {
      const uploaded = await uploadBufferToCloudinary(authLoginFile.buffer, "site/auth-login", "image");
      if (existing.authLoginPublicId) {
        await deleteFromCloudinary(existing.authLoginPublicId, "image");
      }
      updates.authLoginImageUrl = uploaded.url;
      updates.authLoginPublicId = uploaded.publicId;
    }

    const authSignupFile = files?.authSignupImage?.[0];
    if (authSignupFile) {
      const uploaded = await uploadBufferToCloudinary(authSignupFile.buffer, "site/auth-signup", "image");
      if (existing.authSignupPublicId) {
        await deleteFromCloudinary(existing.authSignupPublicId, "image");
      }
      updates.authSignupImageUrl = uploaded.url;
      updates.authSignupPublicId = uploaded.publicId;
    }

    const updated = await SiteContentModel.upsertSiteContent(updates);
    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}