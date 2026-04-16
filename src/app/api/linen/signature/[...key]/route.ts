import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { readLinenSignatureObject } from "@/lib/linen/signature-upload";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest, { params }: { params: { key: string[] } }) {
  try {
    await requireLinenAccess(request);
    const key = params.key.join("/");
    const buffer = await readLinenSignatureObject(key);
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("api/linen/signature GET failed", error);
    const { status, message } = linenApiError(error, "Failed to load signature.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
