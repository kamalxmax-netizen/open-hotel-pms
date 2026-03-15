import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/* ─── GET /api/bug-reports ────────────────────────
   List bug reports (admin view), newest first
*/
export async function GET(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const status = request.nextUrl.searchParams.get("status");

  let query = supabase
    .from("bug_reports")
    .select("id, reported_by, reporter_email, page_url, description, screenshot_url, browser_info, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (status) query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, reports: data ?? [] });
}

/* ─── POST /api/bug-reports ───────────────────────
   Create a new bug report
   Body: { description, page_url, reporter_email?, browser_info?, screenshot_base64? }
*/
export async function POST(request: NextRequest) {
  const supabase = createServerSupabaseClient();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { description, page_url, reporter_email, browser_info, screenshot_base64 } = body;

  if (!description || !page_url) {
    return NextResponse.json({ error: "description and page_url are required" }, { status: 400 });
  }

  // Upload screenshot to Supabase Storage (if provided)
  let screenshot_url: string | null = null;
  if (screenshot_base64) {
    try {
      // Decode base64 → Uint8Array
      const base64Data = screenshot_base64.replace(/^data:image\/\w+;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("bug-report-screenshots")
        .upload(filename, buffer, {
          contentType: "image/jpeg",
          upsert: false,
        });

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from("bug-report-screenshots")
          .getPublicUrl(filename);
        screenshot_url = urlData?.publicUrl ?? null;
      }
    } catch {
      // Non-blocking: if storage fails, still save the report without screenshot
    }
  }

  const { data, error } = await supabase
    .from("bug_reports")
    .insert({
      reporter_email: reporter_email ?? null,
      page_url,
      description,
      screenshot_url,
      browser_info: browser_info ?? null,
      status: "open",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, report: data }, { status: 201 });
}

/* ─── PATCH /api/bug-reports ──────────────────────
   Update status of a bug report
   Body: { id, status }
*/
export async function PATCH(request: NextRequest) {
  const supabase = createServerSupabaseClient();
  const { id, status } = await request.json();

  const VALID_STATUSES = ["open", "in_progress", "resolved", "wontfix"];
  if (!id || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "id and valid status required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("bug_reports")
    .update({ status })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
