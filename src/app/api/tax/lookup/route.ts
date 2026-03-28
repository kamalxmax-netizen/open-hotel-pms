import { NextResponse } from "next/server";
import { createCipheriv } from "crypto";

type RequestBody = {
  taxId?: string;
  tax_id?: string;
};

function isValidTaxId(taxId: string) {
  return /^\d{13}$/.test(taxId);
}

function encryptInfo(text: string) {
  const key = Buffer.from("V7wfrGb5XJDgdfs3", "utf8");
  const iv = Buffer.from("DwDvDB1fJlNKIlPt", "utf8");
  const cipher = createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(true);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return encodeURIComponent(encrypted.toString("base64"));
}

function pickFirst(record: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = record[k];
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) continue;
      if (s === "-" || s === "--") continue;
      if (/^(n\/a|na|null|undefined)$/i.test(s)) continue;
      return s;
    }
  }
  return "";
}

function buildName(record: Record<string, unknown>) {
  const tradeName = pickFirst(record, ["tradeName", "companyName", "fullName"]);
  if (tradeName) return tradeName;
  const parts = [
    pickFirst(record, ["titleName", "titleCode"]),
    pickFirst(record, ["firstName"]),
    pickFirst(record, ["midName"]),
    pickFirst(record, ["lastName", "surName"]),
  ].filter(Boolean);
  return parts.join(" ").trim();
}

function extractBranchDetail(record: Record<string, unknown>): string {
  const direct = pickFirst(record, [
    "branchDetail",
    "branchDet",
    "braDet",
    "branch_detail",
    "braDetail",
  ]);
  if (direct) return direct;

  for (const [k, v] of Object.entries(record)) {
    if (typeof v !== "string" || !v.trim()) continue;
    const key = k.toLowerCase();
    if (key.includes("branch") && key.includes("detail")) return v.trim();
    if (key.includes("bra") && key.includes("det")) return v.trim();
  }

  for (const v of Object.values(record)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const nested = extractBranchDetail(v as Record<string, unknown>);
    if (nested) return nested;
  }

  return "";
}

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function sanitizeBranchAddressLine(s: string) {
  let out = normalizeSpaces(s);
  out = out.replace(/ห้องเลขที่\s*-\s*/g, "");
  out = out.replace(/ชั้นที่\s*-\s*/g, "");
  out = out.replace(/ตรอก\/ซอย\s*-\s*/g, "");
  out = out.replace(/\s-\s/g, " ");
  out = out.replace(/\s{2,}/g, " ").trim();

  const idx = out.indexOf("เลขที่");
  if (idx >= 0) out = out.slice(idx);
  return normalizeSpaces(out);
}

function extractNameFromBranchDetail(detail: string) {
  const lines = detail
    .split(/\r?\n/)
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);
  if (!lines.length) return "";
  const first = lines[0];
  if (
    first.includes("บริษัท") ||
    first.includes("จำกัด") ||
    first.includes("ห้างหุ้นส่วน") ||
    first.includes("มหาชน")
  ) {
    return first;
  }
  return "";
}

function extractAddressFromBranchDetail(detail: string) {
  const lines = detail
    .split(/\r?\n/)
    .map((x) => normalizeSpaces(x))
    .filter(Boolean);
  if (!lines.length) return "";

  const addrLine = lines.slice(1).join(" ") || lines[0];
  const sanitized = sanitizeBranchAddressLine(addrLine);
  return sanitized;
}

function buildAddress(record: Record<string, unknown>) {
  const full = pickFirst(record, [
    "fullAddress",
    "address",
    "addr",
    "addressLine",
    "addrText",
    "regAddr",
    "location",
    "braAdd",
  ]);
  if (full) return full;

  const houseNo = pickFirst(record, [
    "addNo",
    "addrNo",
    "houseNo",
    "homeNo",
    "hno",
    "houseNumber",
  ]);
  const mooNo = pickFirst(record, ["villageNo", "mooNo", "moo", "village"]);
  const soi = pickFirst(record, ["soiName", "soi", "soiNo"]);
  const road = pickFirst(record, ["thnName", "roadName", "road", "street"]);
  const subDistrict = pickFirst(record, [
    "tamName",
    "subDistrictName",
    "subDistrict",
    "tambon",
    "tmblName",
    "tmblNam",
    "subDistName",
  ]);
  const district = pickFirst(record, [
    "districtName",
    "district",
    "amphur",
    "amphoe",
    "ampName",
    "amphName",
    "distName",
  ]);
  const province = pickFirst(record, ["provinceName", "province", "prvcName", "provName"]);
  const zipCode = pickFirst(record, ["zipCode", "postalCode", "postcode", "postCode"]);
  const isBangkok =
    province === "กรุงเทพมหานคร" ||
    province === "กรุงเทพฯ" ||
    province.toLowerCase() === "bangkok";
  const subDistrictLabel = isBangkok ? "แขวง" : "ตำบล";
  const districtLabel = isBangkok ? "เขต" : "อำเภอ";

  const parts = [
    houseNo ? `เลขที่${houseNo}` : "",
    mooNo ? `หมู่ที่${mooNo}` : "",
    soi ? `ซอย${soi}` : "",
    road ? `ถนน${road}` : "",
    subDistrict ? `${subDistrictLabel}${subDistrict}` : "",
    district ? `${districtLabel}${district}` : "",
    province ? `จังหวัด${province}` : "",
    zipCode,
  ].filter(Boolean);

  if (parts.length) return parts.join(" ").trim();

  const guessed = Object.entries(record)
    .filter(([k, v]) => {
      if (typeof v !== "string" || !v.trim()) return false;
      const key = k.toLowerCase();
      return (
        key.includes("addr") ||
        key.includes("road") ||
        key.includes("soi") ||
        key.includes("moo") ||
        key.includes("zip") ||
        key.includes("post") ||
        key.includes("province") ||
        key.includes("district") ||
        key.includes("amph") ||
        key.includes("tambon") ||
        key.includes("tmbl") ||
        key.includes("prvc")
      );
    })
    .map(([, v]) => String(v).trim())
    .filter(Boolean);

  return guessed.join(" ").trim();
}

function buildAddressFromNested(record: Record<string, unknown>) {
  const nestedObjects = Object.values(record).filter(
    (v): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v),
  );
  for (const obj of nestedObjects) {
    const fromNested = buildAddress(obj);
    if (fromNested) return fromNested;
  }
  return "";
}

function buildAddressFromAddressInformation(record: Record<string, unknown>) {
  const info = record.addressInformation;
  if (!info || typeof info !== "object" || Array.isArray(info)) return "";
  return buildAddress(info as Record<string, unknown>);
}

function collectStringsDeep(value: unknown, out: string[]) {
  if (typeof value === "string") {
    const s = value.trim();
    if (s) out.push(s);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectStringsDeep(v, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStringsDeep(v, out);
    }
  }
}

function guessAddressFromAllStrings(record: Record<string, unknown>) {
  const strings: string[] = [];
  collectStringsDeep(record, strings);
  if (!strings.length) return "";

  const tokens = [
    "ถ.",
    "ถนน",
    "ซอย",
    "หมู่",
    "ต.",
    "ตำบล",
    "แขวง",
    "อ.",
    "อำเภอ",
    "เขต",
    "จ.",
    "จังหวัด",
    "road",
    "soi",
    "subdistrict",
    "district",
    "province",
    "postal",
    "postcode",
    "zip",
  ];

  const ranked = strings
    .map((s) => {
      const lower = s.toLowerCase();
      const scoreToken = tokens.some((t) => lower.includes(t)) ? 1000 : 0;
      const scoreLength = Math.min(s.length, 200);
      const score = scoreToken + scoreLength;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.s || "";
  if (best.length < 12) return "";
  return best;
}

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<RequestBody>;
    const taxId = String(body.tax_id || body.taxId || "").trim();

    if (!isValidTaxId(taxId)) {
      return NextResponse.json({ ok: false, success: false, error: "invalid taxId" }, { status: 400 });
    }

    const nid = encryptInfo(taxId);
    const braNo = encryptInfo("0");
    const url =
      "https://eservice.rd.go.th/rd-ves-service/vesweb/search/vatRegistrantsIn/1" +
      `?nid=${nid}&braNo=${braNo}`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        accept: "application/json, text/plain, */*",
        origin: "https://eservice.rd.go.th",
        referer: "https://eservice.rd.go.th/rd-ves-web/search/vat",
      },
      cache: "no-store",
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { ok: false, success: false, error: "non-json response from RD", raw: text.slice(0, 500) },
        { status: 502 },
      );
    }

    const arr = Array.isArray(json) ? json : [];
    if (!arr.length || typeof arr[0] !== "object" || !arr[0]) {
      return NextResponse.json({ ok: false, success: false, error: "not found" }, { status: 404 });
    }

    const record = arr[0] as Record<string, unknown>;
    const branchDetail = extractBranchDetail(record);
    const name =
      extractNameFromBranchDetail(branchDetail) ||
      buildName(record);
    const address = buildAddressFromAddressInformation(record) ||
      extractAddressFromBranchDetail(branchDetail) ||
      buildAddress(record) ||
      buildAddressFromNested(record) ||
      guessAddressFromAllStrings(record);
    const branch = pickFirst(record, [
      "branchNo",
      "branch_no",
      "branchNumber",
      "braNo",
      "branchCode",
    ]) || "00000";

    return NextResponse.json({
      ok: true,
      success: true,
      taxId,
      tax_id: taxId,
      name: name || "",
      address: address || "",
      branch,
      source: "rd-ves-service",
      raw: record,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, success: false, error: String(err instanceof Error ? err.message : err) },
      { status: 500 },
    );
  }
}
