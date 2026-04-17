import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    duration_min: z.number().int().positive().optional(),
    category: z.string().trim().min(1).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

const paramsSchema = z.object({ id: z.string().uuid("Invalid template id") });

export async function PUT(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    const parsedBody = updateTemplateSchema.safeParse(body);
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsedBody.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("extra_task_templates")
      .update(parsedBody.data)
      .eq("id", parsedParams.data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      const isConflict = error.code === "23505";
      return NextResponse.json(
        { error: isConflict ? "Template name already exists." : error.message },
        { status: isConflict ? 409 : 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("extra-tasks/templates/[id] PUT unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const parsedParams = paramsSchema.safeParse(context.params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: "Invalid params.", details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("extra_task_templates")
      .delete()
      .eq("id", parsedParams.data.id)
      .select("id")
      .maybeSingle();

    if (error) {
      const isForeignKey = error.code === "23503";
      if (isForeignKey) {
        const { data: updated, error: updateError } = await supabase
          .from("extra_task_templates")
          .update({ is_active: false })
          .eq("id", parsedParams.data.id)
          .select("id")
          .maybeSingle();

        if (updateError) {
          return NextResponse.json({ error: updateError.message }, { status: 500 });
        }
        if (!updated) {
          return NextResponse.json({ error: "Template not found." }, { status: 404 });
        }

        return NextResponse.json({ success: true, deactivated: true });
      }

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Template not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("extra-tasks/templates/[id] DELETE unexpected", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
