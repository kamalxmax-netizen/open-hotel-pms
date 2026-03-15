import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";

const TRACE_DEPTS = ["FD", "HK", "MAINT", "MGMT", "OTHER"] as const;

export async function GET(request: NextRequest) {
  noStore();
  try {
    const supabase = createServerSupabaseClient();
    const active = request.nextUrl.searchParams.get("active");
    const dept = request.nextUrl.searchParams.get("dept");

    let query = supabase
      .from("trace_templates")
      .select("id, name, dept, template_text, is_active, sort_order, created_at")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true });

    if (active === "true") query = query.eq("is_active", true);
    if (active === "false") query = query.eq("is_active", false);
    if (dept && TRACE_DEPTS.includes(String(dept).toUpperCase() as any)) {
      query = query.eq("dept", String(dept).toUpperCase());
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, templates: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const dept = String(body.dept ?? "FD").trim().toUpperCase();
    const templateText = String(body.template_text ?? "").trim();
    const sortOrder = Number(body.sort_order ?? 0);

    if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });
    if (!TRACE_DEPTS.includes(dept as any)) return NextResponse.json({ error: "invalid dept." }, { status: 400 });
    if (!templateText) return NextResponse.json({ error: "template_text is required." }, { status: 400 });
    if (!Number.isFinite(sortOrder)) return NextResponse.json({ error: "sort_order must be a number." }, { status: 400 });

    const supabase = createServerSupabaseClient();
    const { data, error } = await supabase
      .from("trace_templates")
      .insert({
        name,
        dept,
        template_text: templateText,
        is_active: body.is_active === undefined ? true : Boolean(body.is_active),
        sort_order: Math.trunc(sortOrder),
      })
      .select("id, name, dept, template_text, is_active, sort_order, created_at")
      .maybeSingle();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, template: data }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
