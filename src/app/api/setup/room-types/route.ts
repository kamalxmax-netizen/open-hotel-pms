import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const updateSchema = z.object({
  room_type_id: z.coerce.number().int().positive(),
  cleaning_duration_min: z.coerce.number().int().min(1).max(600),
  max_guests: z.coerce.number().int().min(1).max(8),
});

function isMissingCleaningDurationColumn(error: { message?: string | null } | null): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("cleaning_duration_min");
}

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("room_types")
      .select("id, code, name_en, cleaning_duration_min, max_guests")
      .order("id", { ascending: true });

    if (error) {
      if (isMissingCleaningDurationColumn(error)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "DB migration required: apply 20260228_housekeeping_phase6.sql before configuring cleaning duration.",
          },
          { status: 500 }
        );
      }
      throw error;
    }

    const roomTypes = (data ?? []).map((row: any) => ({
      id: Number(row.id),
      code: String(row.code ?? ""),
      name_en: String(row.name_en ?? ""),
      cleaning_duration_min: Math.max(Number(row.cleaning_duration_min ?? 60), 1),
      max_guests: Math.max(Number(row.max_guests ?? 2), 1),
    }));

    return NextResponse.json({ success: true, room_types: roomTypes });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const json = await req.json().catch(() => null);
    const parsed = updateSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { room_type_id, cleaning_duration_min, max_guests } = parsed.data;
    const { data, error } = await supabase
      .from("room_types")
      .update({ cleaning_duration_min, max_guests })
      .eq("id", room_type_id)
      .select("id, code, name_en, cleaning_duration_min, max_guests")
      .single();

    if (error) {
      if (isMissingCleaningDurationColumn(error)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "DB migration required: apply 20260228_housekeeping_phase6.sql before configuring cleaning duration.",
          },
          { status: 500 }
        );
      }
      if (error.code === "PGRST116") {
        return NextResponse.json({ success: false, error: "Room type not found." }, { status: 404 });
      }
      throw error;
    }

    return NextResponse.json({
      success: true,
      room_type: {
        id: Number((data as any).id),
        code: String((data as any).code ?? ""),
        name_en: String((data as any).name_en ?? ""),
        cleaning_duration_min: Math.max(Number((data as any).cleaning_duration_min ?? 60), 1),
        max_guests: Math.max(Number((data as any).max_guests ?? 2), 1),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
