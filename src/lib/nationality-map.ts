import { NATIONALITY_MAP as NATIONALITY_DISPLAY_MAP } from "@/lib/nationality";

export type NationalityEntry = {
  code: string;
  demonym: string;
  country: string;
  flag: string;
  iso2: string | null;
};

const POPULAR_NATIONALITY_CODES = [
  "THA",
  "GBR",
  "USA",
  "AUS",
  "CAN",
  "NZL",
  "DEU",
  "FRA",
  "ESP",
  "ITA",
  "NLD",
  "BEL",
  "CHE",
  "AUT",
  "SWE",
  "NOR",
  "DNK",
  "FIN",
  "RUS",
  "UKR",
  "POL",
  "CZE",
  "HUN",
  "ROU",
  "TUR",
  "IND",
  "PAK",
  "BGD",
  "LKA",
  "NPL",
  "CHN",
  "HKG",
  "TWN",
  "JPN",
  "KOR",
  "MNG",
  "SGP",
  "MYS",
  "IDN",
  "VNM",
  "KHM",
  "LAO",
  "MMR",
  "PHL",
  "ARE",
  "SAU",
  "QAT",
  "KWT",
  "OMN",
  "BHR",
  "ISR",
  "EGY",
  "ZAF",
  "KEN",
  "NGA",
  "MEX",
  "BRA",
  "ARG",
  "CHL",
  "COL",
  "PER",
] as const;

const SPECIAL_NATIONALITIES: Record<string, { name: string; flag: string; country: string; iso2: string | null }> = {
  XKX: { name: "Kosovar", flag: "🇽🇰", country: "Kosovo", iso2: "XK" },
  UNK: { name: "Unknown", flag: "🏳️", country: "Unknown", iso2: null },
};

const COUNTRY_OVERRIDES: Record<string, string> = {
  BOL: "Bolivia",
  BRN: "Brunei",
  CCK: "Cocos Islands",
  CIV: "Cote d'Ivoire",
  COD: "Democratic Republic of the Congo",
  COG: "Republic of the Congo",
  COK: "Cook Islands",
  CPV: "Cape Verde",
  CZE: "Czech Republic",
  FLK: "Falkland Islands",
  FSM: "Micronesia",
  HKG: "Hong Kong",
  IRN: "Iran",
  KOR: "South Korea",
  LAO: "Laos",
  MAC: "Macau",
  MDA: "Moldova",
  MKD: "North Macedonia",
  MMR: "Myanmar",
  PSE: "Palestine",
  PRK: "North Korea",
  RUS: "Russia",
  SWZ: "Eswatini",
  SYR: "Syria",
  TCA: "Turks and Caicos Islands",
  TWN: "Taiwan",
  TZA: "Tanzania",
  VAT: "Vatican City",
  VEN: "Venezuela",
  VNM: "Vietnam",
};

const STATIC_ALIASES: Array<[string, string]> = [
  ["THAI", "THA"],
  ["THAILAND", "THA"],
  ["UK", "GBR"],
  ["U.K.", "GBR"],
  ["UNITED KINGDOM", "GBR"],
  ["BRITISH", "GBR"],
  ["US", "USA"],
  ["U.S.", "USA"],
  ["USA", "USA"],
  ["UNITED STATES", "USA"],
  ["UNITED STATES OF AMERICA", "USA"],
  ["AMERICAN", "USA"],
  ["JAPAN", "JPN"],
  ["JAPANESE", "JPN"],
  ["KOREA", "KOR"],
  ["SOUTH KOREA", "KOR"],
  ["KOREAN", "KOR"],
  ["CHINA", "CHN"],
  ["CHINESE", "CHN"],
  ["GERMANY", "DEU"],
  ["GERMAN", "DEU"],
  ["FRANCE", "FRA"],
  ["FRENCH", "FRA"],
  ["BOLIVIA", "BOL"],
  ["BOLIVIAN", "BOL"],
  ["GEORGIA", "GEO"],
  ["GEORGIAN", "GEO"],
  ["UNKNOWN", "UNK"],
  ["UNK", "UNK"],
  ["KOSOVO", "XKX"],
  ["KOSOVAR", "XKX"],
];

function decodeFlagEmojiToIso2(flag: string): string | null {
  const chars = Array.from(flag);
  if (chars.length !== 2) return null;
  const code = chars
    .map((char) => char.codePointAt(0))
    .filter((point): point is number => typeof point === "number")
    .map((point) => {
      const offset = point - 0x1f1e6;
      if (offset < 0 || offset > 25) return null;
      return String.fromCharCode(65 + offset);
    });
  if (code.length !== 2 || code.includes(null as never)) return null;
  return code.join("");
}

const RegionDisplayNames = (Intl as unknown as {
  DisplayNames?: new (locales: string[], options: { type: "region" }) => { of: (code: string) => string | undefined };
}).DisplayNames;

const regionNames = RegionDisplayNames
  ? new RegionDisplayNames(["en"], { type: "region" })
  : null;

function getCountryName(code: string, flag: string, explicitCountry?: string): string {
  if (explicitCountry) return explicitCountry;
  if (COUNTRY_OVERRIDES[code]) return COUNTRY_OVERRIDES[code];
  const iso2 = decodeFlagEmojiToIso2(flag);
  if (!iso2) return "";
  return regionNames?.of(iso2) ?? "";
}

function buildNationalityEntries(): NationalityEntry[] {
  const generated = Object.entries(NATIONALITY_DISPLAY_MAP)
    .filter(([code]) => code !== "UNK")
    .map(([code, info]) => {
      const iso2 = decodeFlagEmojiToIso2(info.flag);
      return {
        code,
        demonym: info.name || code,
        country: getCountryName(code, info.flag),
        flag: info.flag,
        iso2,
      };
    });

  const special = Object.entries(SPECIAL_NATIONALITIES).map(([code, info]) => ({
    code,
    demonym: info.name,
    country: info.country,
    flag: info.flag,
    iso2: info.iso2,
  }));

  const byCode = new Map<string, NationalityEntry>();
  for (const entry of [...generated, ...special]) {
    byCode.set(entry.code, entry);
  }

  const ordered: NationalityEntry[] = [];
  for (const code of POPULAR_NATIONALITY_CODES) {
    const entry = byCode.get(code);
    if (!entry) continue;
    ordered.push(entry);
    byCode.delete(code);
  }

  return [
    ...ordered,
    ...Array.from(byCode.values()).sort((a, b) => {
      if (a.code === "UNK") return 1;
      if (b.code === "UNK") return -1;
      return a.country.localeCompare(b.country) || a.code.localeCompare(b.code);
    }),
  ];
}

export const NATIONALITIES: NationalityEntry[] = buildNationalityEntries();

const NATIONALITY_BY_CODE = new Map<string, NationalityEntry>(
  NATIONALITIES.map((entry) => [entry.code.toUpperCase(), entry])
);

function aliasKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const ALIASES_TO_CODE = new Map<string, string>();

for (const entry of NATIONALITIES) {
  for (const alias of [entry.code, entry.iso2, entry.demonym, entry.country]) {
    if (!alias) continue;
    ALIASES_TO_CODE.set(aliasKey(alias), entry.code);
  }
}

for (const [alias, code] of STATIC_ALIASES) {
  ALIASES_TO_CODE.set(aliasKey(alias), code);
}

export function normalizeNationalityCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().toUpperCase();
  if (!raw) return null;
  if (NATIONALITY_BY_CODE.has(raw)) return raw;
  return ALIASES_TO_CODE.get(aliasKey(input)) ?? null;
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

export function getFlagEmojiByNationalityCode(code: string | null | undefined): string {
  const normalized = normalizeNationalityCode(code);
  if (!normalized) return "🏳️";
  return NATIONALITY_BY_CODE.get(normalized)?.flag ?? "🏳️";
}
