import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { uploadR2Object } from "@/lib/r2";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function safeSegment(value: FormDataEntryValue | null, fallback: string) {
  const text = String(value ?? "").trim();
  return (text || fallback).replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}

export async function POST(request: NextRequest) {
  try {
    await requireLinenAccess(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "file is required." }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ success: false, error: "Rewash photo must be 1 byte to 2MB after resize." }, { status: 400 });
    }

    const contentType = file.type || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
      return NextResponse.json({ success: false, error: "Unsupported image type." }, { status: 400 });
    }

    const batchId = safeSegment(formData.get("batch_id"), "batch");
    const eventTmpId = safeSegment(formData.get("event_tmp_id"), "tmp");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const key = `rewash/linen/${batchId}/${eventTmpId}/${timestamp}.jpg`;
    const buffer = Buffer.from(await file.arrayBuffer());

    await uploadR2Object({ key, body: buffer, contentType });
    return NextResponse.json({ success: true, data: { object_key: key } });
  } catch (error) {
    console.error("api/linen/rewash/photo POST failed", error);
    const { status, message } = linenApiError(error, "Failed to upload rewash photo.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
