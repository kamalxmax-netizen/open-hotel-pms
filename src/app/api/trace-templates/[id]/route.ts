import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

const TRACE_DEPTS = ["FD", "HK", "MAINT", "MGMT", "OTHER"] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid template id." }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name ?? "").trim();
      if (!name) return NextResponse.json({ error: "name cannot be empty." }, { status: 400 });
      updates.name = name;
    }
    if (body.dept !== undefined) {
      const dept = String(body.dept ?? "").trim().toUpperCase();
      if (!TRACE_DEPTS.includes(dept as any)) return NextResponse.json({ error: "invalid dept." }, { status: 400 });
      updates.dept = dept;
    }
    if (body.template_text !== undefined) {
      const templateText = String(body.template_text ?? "").trim();
      if (!templateText) return NextResponse.json({ error: "template_text cannot be empty." }, { status: 400 });
      updates.template_text = templateText;
    }
    if (body.is_active !== undefined) updates.is_active = Boolean(body.is_active);
    if (body.sort_order !== undefined) {
      const sortOrder = Number(body.sort_order);
      if (!Number.isFinite(sortOrder)) return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });
      updates.sort_order = Math.trunc(sortOrder);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("trace_templates")
      .update(updates)
      .eq("id", id)
      .select("id, name, dept, template_text, is_active, sort_order, created_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Template not found." }, { status: 404 });
    return NextResponse.json({ success: true, template: data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = Number(params.id);
    if (!Number.isFinite(id)) return NextResponse.json({ error: "Invalid template id." }, { status: 400 });

    const supabase = createServerSupabaseClient();
    const { error } = await supabase
      .from("trace_templates")
      .delete()
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
