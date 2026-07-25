import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma.js";

const SITE_CONTENT_ID = "singleton";

/**
 * There is exactly one SiteContent row, ever. Fetch it, creating an empty
 * one on first-ever call (e.g. right after migrating) so callers never have
 * to null-check "has anyone configured this yet".
 */
export function getSiteContent() {
  return prisma.siteContent
    .findUnique({ where: { id: SITE_CONTENT_ID } })
    .then((existing) => existing ?? prisma.siteContent.create({ data: { id: SITE_CONTENT_ID } }));
}

export interface SiteContentUpdateInput {
  siteName?: string;

  homeHeroImageUrl?: string;
  homeHeroPublicId?: string;
  homeHeroEyebrow?: string;
  homeHeroTitle?: string;
  homeHeroSubtitle?: string;
  // Prisma's generated Json field type won't accept a plain `unknown` —
  // it needs Prisma.InputJsonValue instead.
  homeStats?: Prisma.InputJsonValue;

  aboutHeroImageUrl?: string;
  aboutHeroPublicId?: string;
  aboutIntro?: string;
  aboutBody?: string;
  aboutClosing?: string;
  aboutFeatures?: Prisma.InputJsonValue;

  authLoginImageUrl?: string;
  authLoginPublicId?: string;
  authSignupImageUrl?: string;
  authSignupPublicId?: string;

  footerTagline?: string;
  footerPhone?: string;
  footerEmail?: string;
  footerAddress?: string;

  contactAddress?: string;
  contactPhone?: string;
  contactEmail?: string;
  contactResponseNote?: string;

  socialLinks?: Prisma.InputJsonValue;
}

export function upsertSiteContent(data: SiteContentUpdateInput) {
  return prisma.siteContent.upsert({
    where: { id: SITE_CONTENT_ID },
    create: { id: SITE_CONTENT_ID, ...data },
    update: data,
  });
}