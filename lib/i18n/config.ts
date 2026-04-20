import Negotiator from "negotiator";

export const locales = ["en", "ja"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}

export function detectLocaleFromAcceptLanguage(header: string | null): Locale {
  if (!header) return defaultLocale;
  try {
    const negotiator = new Negotiator({ headers: { "accept-language": header } });
    const matched = negotiator.languages([...locales] as string[]);
    const first = matched[0];
    return isLocale(first) ? first : defaultLocale;
  } catch {
    return defaultLocale;
  }
}
