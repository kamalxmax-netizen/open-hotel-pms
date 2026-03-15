export type NationalityEntry = {
  code: string;
  demonym: string;
  country: string;
};

export const NATIONALITIES: NationalityEntry[] = [
  { code: "THA", demonym: "Thai", country: "Thailand" },
  { code: "GBR", demonym: "British", country: "United Kingdom" },
  { code: "USA", demonym: "American", country: "United States" },
  { code: "AUS", demonym: "Australian", country: "Australia" },
  { code: "CAN", demonym: "Canadian", country: "Canada" },
  { code: "NZL", demonym: "New Zealander", country: "New Zealand" },
  { code: "DEU", demonym: "German", country: "Germany" },
  { code: "FRA", demonym: "French", country: "France" },
  { code: "ESP", demonym: "Spanish", country: "Spain" },
  { code: "ITA", demonym: "Italian", country: "Italy" },
  { code: "NLD", demonym: "Dutch", country: "Netherlands" },
  { code: "BEL", demonym: "Belgian", country: "Belgium" },
  { code: "CHE", demonym: "Swiss", country: "Switzerland" },
  { code: "AUT", demonym: "Austrian", country: "Austria" },
  { code: "SWE", demonym: "Swedish", country: "Sweden" },
  { code: "NOR", demonym: "Norwegian", country: "Norway" },
  { code: "DNK", demonym: "Danish", country: "Denmark" },
  { code: "FIN", demonym: "Finnish", country: "Finland" },
  { code: "RUS", demonym: "Russian", country: "Russia" },
  { code: "UKR", demonym: "Ukrainian", country: "Ukraine" },
  { code: "POL", demonym: "Polish", country: "Poland" },
  { code: "CZE", demonym: "Czech", country: "Czech Republic" },
  { code: "HUN", demonym: "Hungarian", country: "Hungary" },
  { code: "ROU", demonym: "Romanian", country: "Romania" },
  { code: "TUR", demonym: "Turkish", country: "Turkey" },
  { code: "IND", demonym: "Indian", country: "India" },
  { code: "PAK", demonym: "Pakistani", country: "Pakistan" },
  { code: "BGD", demonym: "Bangladeshi", country: "Bangladesh" },
  { code: "LKA", demonym: "Sri Lankan", country: "Sri Lanka" },
  { code: "NPL", demonym: "Nepalese", country: "Nepal" },
  { code: "CHN", demonym: "Chinese", country: "China" },
  { code: "HKG", demonym: "Hong Konger", country: "Hong Kong" },
  { code: "TWN", demonym: "Taiwanese", country: "Taiwan" },
  { code: "JPN", demonym: "Japanese", country: "Japan" },
  { code: "KOR", demonym: "South Korean", country: "South Korea" },
  { code: "MNG", demonym: "Mongolian", country: "Mongolia" },
  { code: "SGP", demonym: "Singaporean", country: "Singapore" },
  { code: "MYS", demonym: "Malaysian", country: "Malaysia" },
  { code: "IDN", demonym: "Indonesian", country: "Indonesia" },
  { code: "VNM", demonym: "Vietnamese", country: "Vietnam" },
  { code: "KHM", demonym: "Cambodian", country: "Cambodia" },
  { code: "LAO", demonym: "Laotian", country: "Laos" },
  { code: "MMR", demonym: "Burmese", country: "Myanmar" },
  { code: "PHL", demonym: "Filipino", country: "Philippines" },
  { code: "ARE", demonym: "Emirati", country: "United Arab Emirates" },
  { code: "SAU", demonym: "Saudi Arabian", country: "Saudi Arabia" },
  { code: "QAT", demonym: "Qatari", country: "Qatar" },
  { code: "KWT", demonym: "Kuwaiti", country: "Kuwait" },
  { code: "OMN", demonym: "Omani", country: "Oman" },
  { code: "BHR", demonym: "Bahraini", country: "Bahrain" },
  { code: "ISR", demonym: "Israeli", country: "Israel" },
  { code: "EGY", demonym: "Egyptian", country: "Egypt" },
  { code: "ZAF", demonym: "South African", country: "South Africa" },
  { code: "KEN", demonym: "Kenyan", country: "Kenya" },
  { code: "NGA", demonym: "Nigerian", country: "Nigeria" },
  { code: "MEX", demonym: "Mexican", country: "Mexico" },
  { code: "BRA", demonym: "Brazilian", country: "Brazil" },
  { code: "ARG", demonym: "Argentine", country: "Argentina" },
  { code: "CHL", demonym: "Chilean", country: "Chile" },
  { code: "COL", demonym: "Colombian", country: "Colombia" },
  { code: "PER", demonym: "Peruvian", country: "Peru" },
  { code: "UNK", demonym: "Unknown", country: "Unknown" },
];

const NATIONALITY_BY_CODE = new Map<string, NationalityEntry>(
  NATIONALITIES.map((entry) => [entry.code.toUpperCase(), entry])
);

const ALIASES_TO_CODE = new Map<string, string>([
  ["THAI", "THA"],
  ["THAILAND", "THA"],
  ["UK", "GBR"],
  ["BRITISH", "GBR"],
  ["US", "USA"],
  ["AMERICAN", "USA"],
  ["JAPAN", "JPN"],
  ["JAPANESE", "JPN"],
  ["KOREAN", "KOR"],
  ["CHINESE", "CHN"],
  ["GERMAN", "DEU"],
  ["FRENCH", "FRA"],
]);

export function normalizeNationalityCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().toUpperCase();
  if (!raw) return null;
  if (NATIONALITY_BY_CODE.has(raw)) return raw;
  if (ALIASES_TO_CODE.has(raw)) return ALIASES_TO_CODE.get(raw) ?? null;
  return null;
}

export function getCountryByCode(code: string | null | undefined): string | null {
  const normalized = normalizeNationalityCode(code);
  if (!normalized) return null;
  return NATIONALITY_BY_CODE.get(normalized)?.country ?? null;
}

export function getDemonymByCode(code: string | null | undefined): string | null {
  const normalized = normalizeNationalityCode(code);
  if (!normalized) return null;
  return NATIONALITY_BY_CODE.get(normalized)?.demonym ?? null;
}

export function formatNationality(code: string | null | undefined): string {
  const normalized = normalizeNationalityCode(code);
  if (!normalized) return "";
  const demonym = NATIONALITY_BY_CODE.get(normalized)?.demonym ?? normalized;
  return `${normalized}, ${demonym}`;
}

const NATIONALITY_TO_FLAG_ISO2: Record<string, string> = {
  THA: "TH",
  GBR: "GB",
  USA: "US",
  AUS: "AU",
  CAN: "CA",
  NZL: "NZ",
  DEU: "DE",
  FRA: "FR",
  ESP: "ES",
  ITA: "IT",
  NLD: "NL",
  BEL: "BE",
  CHE: "CH",
  AUT: "AT",
  SWE: "SE",
  NOR: "NO",
  DNK: "DK",
  FIN: "FI",
  RUS: "RU",
  UKR: "UA",
  POL: "PL",
  CZE: "CZ",
  HUN: "HU",
  ROU: "RO",
  TUR: "TR",
  IND: "IN",
  PAK: "PK",
  BGD: "BD",
  LKA: "LK",
  NPL: "NP",
  CHN: "CN",
  HKG: "HK",
  TWN: "TW",
  JPN: "JP",
  KOR: "KR",
  MNG: "MN",
  SGP: "SG",
  MYS: "MY",
  IDN: "ID",
  VNM: "VN",
  KHM: "KH",
  LAO: "LA",
  MMR: "MM",
  PHL: "PH",
  ARE: "AE",
  SAU: "SA",
  QAT: "QA",
  KWT: "KW",
  OMN: "OM",
  BHR: "BH",
  ISR: "IL",
  EGY: "EG",
  ZAF: "ZA",
  KEN: "KE",
  NGA: "NG",
  MEX: "MX",
  BRA: "BR",
  ARG: "AR",
  CHL: "CL",
  COL: "CO",
  PER: "PE",
};

function iso2ToFlagEmoji(iso2: string): string {
  if (!/^[A-Z]{2}$/.test(iso2)) return "🏳️";
  const codePoints = Array.from(iso2).map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}

export function getFlagEmojiByNationalityCode(code: string | null | undefined): string {
  const normalized = normalizeNationalityCode(code);
  if (!normalized) return "🏳️";
  const iso2 = NATIONALITY_TO_FLAG_ISO2[normalized];
  if (!iso2) return "🏳️";
  return iso2ToFlagEmoji(iso2);
}
