import { parsePassportMrz } from "@/lib/passport-ocr/mrz";
import { detectPassportTextFromBuffer } from "@/lib/passport-ocr/vision";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

type ParsedCandidate = {
  source: string;
  rawText: string;
  parsed: ReturnType<typeof parsePassportMrz>;
};

function scoreParsedResult(parsed: ReturnType<typeof parsePassportMrz>) {
  if (!parsed) return { weightedScore: -1, confidenceScore: 0, confidenceLabel: "Needs manual check" as const };

  let confidenceScore = 0;
  if (parsed.fieldStatus.passportNumber === "ok") confidenceScore += 25;
  if (parsed.fieldStatus.nationality === "ok") confidenceScore += 12;
  if (parsed.fieldStatus.firstName === "ok") confidenceScore += 14;
  if (parsed.fieldStatus.familyName === "ok") confidenceScore += 14;
  if (parsed.fieldStatus.gender === "ok") confidenceScore += 10;
  if (parsed.fieldStatus.dateOfBirth === "ok") confidenceScore += 18;
  if (parsed.mrzLine1.length === 44) confidenceScore += 3;
  if (parsed.mrzLine2.length === 44) confidenceScore += 4;
  confidenceScore = Math.max(0, Math.min(100, confidenceScore - parsed.warnings.length * 3));

  const confidenceLabel =
    confidenceScore >= 85 ? "High confidence" : confidenceScore >= 65 ? "Review suggested" : "Needs manual check";
  const weightedScore = confidenceScore - parsed.warnings.length * 0.1;

  return { weightedScore, confidenceScore, confidenceLabel };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");
    const source = String(formData.get("source") || "tight_mrz");

    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "No image uploaded." }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    if (buffer.length === 0) {
      return NextResponse.json({ success: false, error: "Uploaded image is empty." }, { status: 400 });
    }

    const rawText = await detectPassportTextFromBuffer(buffer);
    if (!rawText) {
      return NextResponse.json(
        { success: false, error: "Vision API could not extract text from this image." },
        { status: 422 }
      );
    }

    const candidates: ParsedCandidate[] = [{ source, rawText, parsed: parsePassportMrz(rawText) }];

    const parsed = candidates[0].parsed;
    const selectedSource = candidates[0].source;
    const selectedText = candidates[0].rawText;
    const selectedMeta = scoreParsedResult(parsed);

    if (!parsed) {
      return NextResponse.json(
        {
          success: false,
          error: "Cannot parse MRZ fields. Retake a clearer photo of the passport MRZ area.",
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      data: parsed,
      meta: {
        selected_source: selectedSource,
        confidence_score: selectedMeta.confidenceScore,
        confidence_label: selectedMeta.confidenceLabel,
      },
      debug: {
        selected_text: selectedText,
        candidates: candidates.map((candidate) => {
          const meta = scoreParsedResult(candidate.parsed);
          return {
            source: candidate.source,
            confidence_score: meta.confidenceScore,
            confidence_label: meta.confidenceLabel,
            parsed: Boolean(candidate.parsed),
          };
        }),
      },
    });
  } catch (error) {
    console.error("api/passport-ocr/scan POST failed", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
