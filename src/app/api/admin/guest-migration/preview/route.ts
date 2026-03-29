import { NextRequest, NextResponse } from "next/server";
import { parseMigrationWorkbook, requireAdminRouteAccess } from "@/lib/guest-migration";

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminRouteAccess(request);
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Missing file. Please upload Excel file as `file`." },
        { status: 400 }
      );
    }

    const parsed = await parseMigrationWorkbook(file);

    return NextResponse.json({
      success: true,
      preview: parsed.preview,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview failed.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

