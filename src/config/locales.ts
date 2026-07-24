// Single source of truth for which locales trip content gets auto-translated
// into. Add a language here and it starts getting machine-translated on the
// next trip create/update — no migration needed (TripTranslation.locale is a
// plain string column, not a Prisma enum).
//
// IMPORTANT: keep these codes in sync with frontend/src/i18n/index.ts and
// with whatever your translation provider expects (DeepL wants upper-case
// target codes like "JA"/"ES"/"KO"/"DE"/"VI" — utils/translate.ts uppercases
// for you, so keep the codes here lower-case and ISO-639-1).
export const SUPPORTED_LOCALES = ["ja", "es", "ko", "de", "vi"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE = "en";

export function isSupportedLocale(locale: string | undefined): locale is SupportedLocale {
  return !!locale && (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}
