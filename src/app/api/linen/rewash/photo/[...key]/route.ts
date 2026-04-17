import { linenApiError, requireLinenAccess } from "@/lib/linen/api-auth";
import { readR2Object } from "@/lib/r2";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest, { params }: { params: { key: string[] } }) {
  try {
    await requireLinenAccess(request);
    const key = (params.key ?? []).join("/");
    if (!key.startsWith("rewash/linen/")) {
      return NextResponse.json({ success: false, error: "Invalid photo key." }, { status: 400 });
    }

    const object = await readR2Object(key);
    return new NextResponse(object.body, {
      status: 200,
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    console.error("api/linen/rewash/photo/[...key] GET failed", error);
    const { status, message } = linenApiError(error, "Failed to read rewash photo.");
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
