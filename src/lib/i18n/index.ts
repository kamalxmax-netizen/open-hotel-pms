import en from "@/lib/i18n/en";
import th from "@/lib/i18n/th";

export type Locale = "en" | "th";

const dictionaries = { en, th };

export function getDictionary(locale: Locale = "en") {
  return dictionaries[locale] ?? dictionaries.en;
}
