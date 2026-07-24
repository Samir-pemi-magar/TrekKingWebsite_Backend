// Wraps whichever machine-translation API you use. DeepL shown here (better
// quality than Google Translate for most of the language set on this site,
// and a generous free tier) — swap the implementation of `translateText` if
// you'd rather use Google Cloud Translate or another provider; nothing else
// in the app needs to change since everything goes through translateFields.
//
// Requires DEEPL_API_KEY in the environment. Uses the free-tier endpoint
// (api-free.deepl.com) — switch to api.deepl.com if you're on a paid plan.
const DEEPL_API_URL = process.env.DEEPL_API_URL || "https://api-free.deepl.com/v2/translate";
const DEEPL_API_KEY = process.env.DEEPL_API_KEY;

export class TranslationError extends Error {}

export async function translateText(text: string, targetLocale: string): Promise<string> {
  if (!text) return text;
  if (!DEEPL_API_KEY) {
    throw new TranslationError("DEEPL_API_KEY is not configured");
  }

  const res = await fetch(DEEPL_API_URL, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: [text],
      target_lang: targetLocale.toUpperCase(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new TranslationError(`DeepL request failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { translations: { text: string }[] };
  return data.translations[0]?.text ?? text;
}

// Translates every string / string[] value in an object, preserving keys and
// leaving undefined/empty values untouched. Used for both Trip and
// ItineraryDay field sets, since both are "a handful of string/string[]
// fields" shapes.
export async function translateFields<T extends Record<string, string | string[] | undefined | null>>(
  fields: T,
  targetLocale: string
): Promise<T> {
  const entries = await Promise.all(
    Object.entries(fields).map(async ([key, value]) => {
      if (value === undefined || value === null || value === "") return [key, value];
      if (Array.isArray(value)) {
        const translated = await Promise.all(value.map((v) => translateText(v, targetLocale)));
        return [key, translated];
      }
      return [key, await translateText(value, targetLocale)];
    })
  );
  return Object.fromEntries(entries) as T;
}
