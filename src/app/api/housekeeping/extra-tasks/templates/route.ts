import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const createTemplateSchema = z.object({
  name: z.string().trim().min(1, "name is required"),
  duration_min: z.number().int().positive().default(60),
  category: z.string().trim().min(1).default("General"),
});

export async function GET() {
  try {
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from("extra_task_templates")
      .select("id, name, duration_min, category, is_active, created_at")
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      console.error("extra-tasks/templates GET failed", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, templates: data ?? [] });
  } catch (err) {
    console.error("extra-tasks/templates GET unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = createTemplateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const payload = parsed.data;
    const supabase = createServerSupabaseClient();

    const { data, error } = await supabase
      .from("extra_task_templates")
      .insert({
        name: payload.name,
        duration_min: payload.duration_min,
        category: payload.category,
      })
      .select("id, name, duration_min, category, is_active, created_at")
      .maybeSingle();

    if (error) {
      const isConflict = error.code === "23505";
      return NextResponse.json(
        { error: isConflict ? "Template name already exists." : error.message },
        { status: isConflict ? 409 : 500 }
      );
    }

    return NextResponse.json({ success: true, template: data }, { status: 201 });
  } catch (err) {
    console.error("extra-tasks/templates POST unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
