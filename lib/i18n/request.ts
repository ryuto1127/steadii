import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import { detectLocaleFromAcceptLanguage, isLocale, defaultLocale } from "./config";
import { en } from "./translations/en";
import { ja } from "./translations/ja";

const messagesByLocale = { en, ja };

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("steadii-locale")?.value;

  let locale: "en" | "ja";
  if (isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const headerList = await headers();
    locale = detectLocaleFromAcceptLanguage(headerList.get("accept-language"));
  }

  const messages = messagesByLocale[locale] ?? messagesByLocale[defaultLocale];
  return { locale, messages };
});
