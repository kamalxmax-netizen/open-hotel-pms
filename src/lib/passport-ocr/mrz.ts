export type PassportOcrFieldStatus = "ok" | "manual_check";

export type PassportOcrFieldMap = {
  passportNumber: PassportOcrFieldStatus;
  nationality: PassportOcrFieldStatus;
  firstName: PassportOcrFieldStatus;
  familyName: PassportOcrFieldStatus;
  gender: PassportOcrFieldStatus;
  dateOfBirth: PassportOcrFieldStatus;
};

export type ParsedPassportMrz = {
  firstName: string | null;
  familyName: string | null;
  nationality: string | null;
  passportNumber: string | null;
  gender: "M" | "F" | "X" | null;
  dateOfBirth: string | null;
  mrzLine1: string;
  mrzLine2: string;
  fieldStatus: PassportOcrFieldMap;
  warnings: string[];
};

const MRZ_ALLOWED_REGEX = /[^A-Z0-9<]/g;

function cleanMrzLine(line: string) {
  return String(line || "")
    .toUpperCase()
    .replace(/«/g, "<")
    .replace(/\s+/g, "")
    .replace(MRZ_ALLOWED_REGEX, "");
}

function fitToMrzLength(line: string) {
  const normalized = String(line || "");
  return normalized.length >= 44 ? normalized.slice(0, 44) : normalized.padEnd(44, "<");
}

function isSupportedLine1Start(line: string) {
  const normalized = String(line || "");
  if (normalized.charAt(0) === "P") return true;

  // Myanmar certificate of identity uses "CI" as the document code and "MMR"
  // as issuer. Keep this intentionally narrow so labels like EXPIRATION DATE
  // cannot be promoted into an MRZ name line.
  return normalized.startsWith("CIMMR");
}

function isMyanmarLine1Start(line: string) {
  const normalized = String(line || "");
  return normalized.startsWith("P<MMR") || normalized.startsWith("CIMMR");
}

function repairMyanmarLine1NameSeparators(line: string) {
  if (!isMyanmarLine1Start(line)) return null;

  const prefix = line.slice(0, 5);
  const body = line.slice(5);
  const fillerIndex = body.search(/<{2,}/);
  const nameEnd = fillerIndex >= 0 ? fillerIndex : body.length;
  const namePart = body.slice(0, nameEnd);
  const suffix = body.slice(nameEnd);
  if (!namePart || namePart.includes("<")) return null;

  const candidates: string[] = [];
  for (let i = 1; i < namePart.length - 1; i += 1) {
    if (!/[KEX]/.test(namePart.charAt(i))) continue;
    candidates.push(`${prefix}${namePart.slice(0, i)}<${namePart.slice(i + 1)}${suffix}`);
  }

  if (namePart.length % 2 === 0) {
    const midpoint = namePart.length / 2;
    const left = namePart.slice(0, midpoint);
    const right = namePart.slice(midpoint);
    if (left.length >= 2 && left === right) {
      candidates.push(`${prefix}${left}<${right}${suffix}`);
    }
  }

  for (const candidate of candidates) {
    const fitted = fitToMrzLength(candidate);
    if (looksLikeMrzLine1(fitted)) return fitted;
  }
  return null;
}

function normalizeLine1Candidate(line: string) {
  if (!line) return null;
  let normalized = line;
  const pIndex = normalized.search(/P[A-Z<]/);
  const ciMyanmarIndex = normalized.search(/CIMMR/);
  const indexes = [pIndex, ciMyanmarIndex].filter((index) => index >= 0);
  if (indexes.length === 0) return null;
  const documentIndex = Math.min(...indexes);
  if (documentIndex > 0) normalized = normalized.slice(documentIndex);

  if (!isSupportedLine1Start(normalized)) {
    return null;
  }

  // OCR frequently misreads "P<" as "PP"/"PM"/"PA".
  // When this shape still looks MRZ-like, normalize back to "P<" and keep issuer at positions 3-5.
  if (normalized.charAt(0) === "P" && normalized.charAt(1) !== "<") {
    const second = normalized.charAt(1);
    const issuerGuess = normalized.slice(2, 5);
    if (/^[A-Z]$/.test(second) && /^[A-Z]{3}$/.test(issuerGuess)) {
      normalized = `P<${normalized.slice(2)}`;
    }
  }

  normalized = fitToMrzLength(normalized);
  if (!looksLikeMrzLine1(normalized)) {
    const repaired = repairMyanmarLine1NameSeparators(normalized);
    if (!repaired) return null;
    return repaired;
  }
  return normalized;
}

function normalizeLine2Candidate(line: string) {
  if (!line || line.startsWith("P<")) return null;
  const normalized = fitToMrzLength(line);
  if (!looksLikeMrzLine2(normalized)) return null;
  return normalized;
}

function looksLikeMrzLine1(line: string) {
  const normalized = fitToMrzLength(String(line || ""));
  if (!normalized || !isSupportedLine1Start(normalized)) return false;

  const documentCode = normalized.slice(0, 2);
  const issuerField = normalized.slice(2, 5);
  const namesField = normalized.slice(5);
  const { familyRaw, givenRaw } = splitMrzNameField(namesField);
  const family = cleanName(familyRaw);
  const given = cleanName(givenRaw);
  const normalizedIssuer = normalizeAlphaCode(issuerField.replace(/</g, ""));

  const documentCodeLike = /^P[A-Z<]$/.test(documentCode) || documentCode === "CI";
  // Some issuers appear as single-character + fillers (e.g. "D<<").
  const issuerLike =
    normalized.startsWith("CI")
      ? normalizedIssuer === "MMR"
      : normalizedIssuer.length >= 1 && normalizedIssuer.length <= 3;
  const namesLike = namesField.includes("<");
  const nameStructureLike = family.length >= 2 && given.length >= 1;

  return documentCodeLike && issuerLike && namesLike && nameStructureLike;
}

function normalizeMrzDigitChar(char: string) {
  const raw = String(char || "").toUpperCase().charAt(0);
  const map: Record<string, string> = {
    O: "0",
    Q: "0",
    D: "0",
    I: "1",
    L: "1",
    Z: "2",
    S: "5",
    B: "8",
    G: "6",
    T: "7",
  };
  if (raw === "<") return "<";
  if (/^\d$/.test(raw)) return raw;
  return map[raw] || raw;
}

function normalizeMrzNumeric(value: string) {
  return String(value || "")
    .toUpperCase()
    .split("")
    .map((char) => normalizeMrzDigitChar(char))
    .join("");
}

function looksLikeMrzLine2(line: string) {
  const normalized = fitToMrzLength(String(line || ""));
  if (!normalized || normalized.startsWith("P<")) return false;

  const passportField = normalized.slice(0, 9);
  const passportCheckDigit = normalizeMrzDigitChar(normalized.slice(9, 10));
  const nationalityField = normalized.slice(10, 13);
  const birthField = normalizeMrzNumeric(normalized.slice(13, 19));
  const birthCheckDigit = normalizeMrzDigitChar(normalized.slice(19, 20));
  const genderField = normalized.slice(20, 21);

  const passportLike = /^[A-Z0-9<]{9}$/.test(passportField);
  const nationalityLike = /^[A-Z<]{3}$/.test(nationalityField);
  const birthLike = /^[0-9<]{6}$/.test(birthField);
  const checkDigitLike = /^[0-9<]$/.test(passportCheckDigit) && /^[0-9<]$/.test(birthCheckDigit);
  const genderLike = /^[MFX<]$/.test(genderField);

  return passportLike && nationalityLike && birthLike && checkDigitLike && genderLike;
}

function extractMrzPairs(rawText: string): [string, string][] {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map(cleanMrzLine)
    .filter((line) => line.length >= 20);

  const pairs: [string, string][] = [];
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
      const line1 = normalizeLine1Candidate(lines[i]);
      const line2 = normalizeLine2Candidate(lines[j]);
      if (!line1 || !line2) continue;
      pairs.push([fitToMrzLength(line1), fitToMrzLength(line2)]);
    }
  }
  return pairs;
}

function parseMergedText(rawText: string) {
  const merged = cleanMrzLine(rawText);
  if (!merged || merged.length < 60) return null;

  let best: ParsedPassportMrz | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < merged.length - 20; i += 1) {
    const line1 = fitToMrzLength(merged.slice(i, i + 44));
    if (!looksLikeMrzLine1(line1)) continue;
    const line2 = fitToMrzLength(merged.slice(i + 44, i + 88));
    if (!looksLikeMrzLine2(line2)) continue;
    const parsed = parseMrzFromLines(line1, line2);
    if (!parsed) continue;
    const score = computeCandidateScore(parsed);
    if (score > bestScore) {
      bestScore = score;
      best = parsed;
    }
  }

  return best;
}

function cleanName(value: string) {
  return String(value || "")
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/2/g, "Z")
    .replace(/4/g, "A")
    .replace(/5/g, "S")
    .replace(/6/g, "G")
    .replace(/7/g, "T")
    .replace(/8/g, "B")
    .replace(/9/g, "G")
    .replace(/<+/g, " ")
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMrzNameField(namesFieldRaw: string) {
  const namesField = String(namesFieldRaw || "").replace(/^<+/g, "").replace(/<+$/g, "");
  if (!namesField) {
    return { familyRaw: "", givenRaw: "" };
  }

  const primaryIndex = namesField.indexOf("<<");
  if (primaryIndex >= 0) {
    const parts = namesField.split("<<");
    const familyRaw = parts[0] || "";
    const givenRaw = parts.slice(1).join("<");
    if (givenRaw) return { familyRaw, givenRaw };
  }

  const tokens = namesField.split(/<+/).filter(Boolean);
  return {
    familyRaw: tokens[0] || "",
    givenRaw: tokens.slice(1).join(" "),
  };
}

function normalizeAlphaCode(value: string) {
  const mapped = String(value || "")
    .toUpperCase()
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/2/g, "Z")
    .replace(/4/g, "A")
    .replace(/5/g, "S")
    .replace(/6/g, "G")
    .replace(/7/g, "T")
    .replace(/8/g, "B")
    .replace(/9/g, "G")
    .replace(/[^A-Z]/g, "");

  return mapped.length >= 3 ? mapped.slice(0, 3) : mapped;
}

function extractMrzNationality(line2: string) {
  const line = fitToMrzLength(String(line2 || ""));
  const primary = normalizeAlphaCode(line.slice(10, 13).replace(/</g, ""));
  if (primary) return primary;

  const fallbackCandidates = [line.slice(9, 12), line.slice(11, 14), line.slice(10, 14)];
  for (const candidate of fallbackCandidates) {
    const normalized = normalizeAlphaCode(candidate.replace(/</g, ""));
    if (normalized) return normalized;
  }
  return "";
}

function expandNationalityCode(value: string) {
  const code = String(value || "").toUpperCase();
  if (!code) return "";
  const aliases: Record<string, string> = { D: "DEU", UK: "GBR" };
  return aliases[code] || code;
}

function normalizeGender(value: string): "M" | "F" | "X" | null {
  const raw = String(value || "")
    .toUpperCase()
    .replace(/[^A-Z<]/g, "")
    .charAt(0);
  if (raw === "M") return "M";
  if (raw === "F") return "F";
  if (raw === "X") return "X";
  return null;
}

function charValue(char: string) {
  if (char === "<") return 0;
  if (/^\d$/.test(char)) return Number(char);
  if (/^[A-Z]$/.test(char)) return char.charCodeAt(0) - 55;
  return 0;
}

function computeMrzCheckDigit(value: string) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < value.length; i += 1) {
    sum += charValue(value.charAt(i)) * weights[i % 3];
  }
  return String(sum % 10);
}

function isMrzCheckDigitValid(value: string, checkDigit: string) {
  const normalized = String(checkDigit || "").replace(/[^0-9<]/g, "").charAt(0);
  if (!normalized || normalized === "<") return false;
  return computeMrzCheckDigit(value) === normalized;
}

function normalizeDatePart(value: string) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function toIsoBirthDate(rawDate: string) {
  const digits = normalizeDatePart(rawDate);
  if (digits.length !== 6) return null;

  const year = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const now = new Date();
  const currentYear2 = now.getUTCFullYear() % 100;
  let fullYear = year <= currentYear2 ? 2000 + year : 1900 + year;

  const iso = `${String(fullYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const candidate = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(candidate.getTime())) return null;

  if (
    candidate.getUTCFullYear() !== fullYear ||
    candidate.getUTCMonth() + 1 !== month ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  if (candidate.getTime() > now.getTime()) {
    fullYear -= 100;
    const fallbackIso = `${String(fullYear).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const fallback = new Date(`${fallbackIso}T00:00:00Z`);
    if (Number.isNaN(fallback.getTime())) return null;
    if (
      fallback.getUTCFullYear() !== fullYear ||
      fallback.getUTCMonth() + 1 !== month ||
      fallback.getUTCDate() !== day
    ) {
      return null;
    }
    return fallbackIso;
  }

  return iso;
}

function parseMrzFromLines(line1: string, line2: string): ParsedPassportMrz | null {
  if (!line1 || !line2 || !isSupportedLine1Start(line1)) return null;

  const warnings: string[] = [];
  const fieldStatus: PassportOcrFieldMap = {
    passportNumber: "manual_check",
    nationality: "manual_check",
    firstName: "manual_check",
    familyName: "manual_check",
    gender: "manual_check",
    dateOfBirth: "manual_check",
  };

  const { familyRaw, givenRaw } = splitMrzNameField(line1.slice(5));
  const familyName = cleanName(familyRaw) || null;
  const firstName = cleanName(givenRaw) || null;
  if (familyName) fieldStatus.familyName = "ok";
  else warnings.push("Family name needs manual check.");
  if (firstName) fieldStatus.firstName = "ok";
  else warnings.push("First name needs manual check.");

  // TD3 passport MRZ line 2 positions:
  //  1-9   passport number
  // 10     passport number check digit
  // 11-13  nationality
  // 14-19  date of birth (YYMMDD)
  // 20     date of birth check digit
  // 21     sex
  const rawPassportNumber = line2.slice(0, 9);
  const passportCheckDigit = normalizeMrzDigitChar(line2.slice(9, 10));
  const cleanedPassportNumber = rawPassportNumber.replace(/</g, "").replace(/[^A-Z0-9]/g, "");
  const passportCandidate = cleanedPassportNumber.length >= 6 && /^[A-Z0-9]+$/.test(cleanedPassportNumber) ? cleanedPassportNumber : null;
  const passportChecksumValid =
    Boolean(passportCandidate) && isMrzCheckDigitValid(rawPassportNumber, passportCheckDigit);
  const passportNumber = passportChecksumValid ? cleanedPassportNumber : passportCandidate;
  if (passportChecksumValid) {
    fieldStatus.passportNumber = "ok";
  } else if (passportNumber) {
    warnings.push("Passport number check digit mismatch. Please verify manually.");
  } else {
    warnings.push("Passport number needs manual check.");
  }

  const nationalityCandidate = expandNationalityCode(extractMrzNationality(line2));
  const nationality = /^[A-Z]{3}$/.test(nationalityCandidate) ? nationalityCandidate : null;
  if (nationality) fieldStatus.nationality = "ok";
  else warnings.push("Nationality needs manual check.");

  const birthRaw = normalizeMrzNumeric(line2.slice(13, 19));
  const birthCheckDigit = normalizeMrzDigitChar(line2.slice(19, 20));
  const birthChecksumValid = isMrzCheckDigitValid(birthRaw, birthCheckDigit);
  const dateOfBirth = birthChecksumValid ? toIsoBirthDate(birthRaw) : null;
  if (dateOfBirth) fieldStatus.dateOfBirth = "ok";
  else warnings.push("DOB needs manual check.");

  const gender = normalizeGender(line2.slice(20, 21));
  if (gender) fieldStatus.gender = "ok";
  else warnings.push("Gender needs manual check.");

  if (!firstName && !familyName && !passportNumber && !nationality) {
    return null;
  }

  return {
    firstName,
    familyName,
    nationality,
    passportNumber,
    gender,
    dateOfBirth,
    mrzLine1: line1,
    mrzLine2: line2,
    fieldStatus,
    warnings,
  };
}

function computeCandidateScore(parsed: ParsedPassportMrz) {
  let score = 0;

  score += parsed.fieldStatus.passportNumber === "ok" ? 45 : parsed.passportNumber ? 18 : 0;
  score += parsed.fieldStatus.nationality === "ok" ? 16 : parsed.nationality ? 8 : 0;
  score += parsed.fieldStatus.familyName === "ok" ? 16 : parsed.familyName ? 6 : 0;
  score += parsed.fieldStatus.firstName === "ok" ? 16 : parsed.firstName ? 6 : 0;
  score += parsed.fieldStatus.dateOfBirth === "ok" ? 8 : 0;
  score += parsed.fieldStatus.gender === "ok" ? 6 : 0;
  if (parsed.firstName && parsed.familyName) score += 8;
  if (parsed.mrzLine1.includes("<<")) score += 4;

  const fillerCount = (parsed.mrzLine1.match(/</g) || []).length + (parsed.mrzLine2.match(/</g) || []).length;
  score += Math.min(6, Math.floor(fillerCount / 8));
  score -= parsed.warnings.length * 3;

  return score;
}

export function parsePassportMrz(rawText: string): ParsedPassportMrz | null {
  const candidates: ParsedPassportMrz[] = [];
  const pairs = extractMrzPairs(rawText);
  for (const [line1, line2] of pairs) {
    const parsed = parseMrzFromLines(line1, line2);
    if (parsed) candidates.push(parsed);
  }

  const mergedParsed = parseMergedText(rawText);
  if (mergedParsed) candidates.push(mergedParsed);
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => computeCandidateScore(b) - computeCandidateScore(a));
  return candidates[0];
}
