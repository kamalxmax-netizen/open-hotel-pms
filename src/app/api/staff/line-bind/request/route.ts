import { createServerSupabaseClient } from "@/lib/supabase/server";
import { assertAdminOrSupervisor, getAuthenticatedUser } from "@/lib/server-auth";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const bodySchema = z.object({
  staff_id: z.string().uuid(),
});

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    const user = await getAuthenticatedUser(supabase, request);

    const json = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (user) {
      try {
        await assertAdminOrSupervisor(supabase, user.id);
      } catch (guardError) {
        const message = guardError instanceof Error ? guardError.message : "Forbidden";
        const status = message === "Forbidden" ? 403 : 500;
        return NextResponse.json({ success: false, error: message }, { status });
      }
    }

    const staffId = parsed.data.staff_id;

    const { data: staffRow, error: staffError } = await supabase
      .from("staff")
      .select("id")
      .eq("id", staffId)
      .maybeSingle();

    if (staffError) {
      return NextResponse.json({ success: false, error: staffError.message }, { status: 500 });
    }
    if (!staffRow) {
      return NextResponse.json({ success: false, error: "Staff not found." }, { status: 404 });
    }

    const { error: invalidateError } = await supabase
      .from("line_binding_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("staff_id", staffId)
      .is("used_at", null);

    if (invalidateError) {
      return NextResponse.json({ success: false, error: invalidateError.message }, { status: 500 });
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertError } = await supabase.from("line_binding_tokens").insert({
      token,
      staff_id: staffId,
      expires_at: expiresAt,
      used_at: null,
    });

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: {
        token,
        expires_at: expiresAt,
        expires_in_minutes: 10,
        instruction: `พิมพ์ข้อความนี้ใน LINE โรงแรม: BIND ${token}`,
      },
    });
  } catch (err) {
    console.error("api/staff/line-bind/request POST failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
