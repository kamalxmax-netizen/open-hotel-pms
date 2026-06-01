import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminRouteAccess } from "@/lib/guest-migration";
import { serializeUiEventLogCaptureEmails } from "@/lib/ui-event-log-settings";
import {
  getUiEventLogArchiveStatus,
  getUiEventLogTypesForCategory,
  normalizeUiEventLogCategory,
  resolveUiEventLogCategory,
} from "@/lib/ui-event-log-categories";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  ids: z.array(z.string().uuid()).optional(),
  delete_filtered: z.boolean().optional(),
  date_from: z.string().trim().optional(),
  date_to: z.string().trim().optional(),
  event_type: z.string().trim().optional(),
  category: z.string().trim().optional(),
  auth_action: z.string().trim().optional(),
  severity: z.string().trim().optional(),
  pathname: z.string().trim().optional(),
  search: z.string().trim().optional(),
}).refine((value) => (value.ids?.length ?? 0) > 0 || value.delete_filtered === true, {
  message: "Provide ids or set delete_filtered=true.",
});

const settingsSchema = z.object({
  capture_emails: z.string().trim().min(1).max(2000),
});

const EXPLICIT_DELETE_CHUNK_SIZE = 200;
const FILTERED_DELETE_PAGE_SIZE = 1000;
const FILTERED_DELETE_MAX_BATCHES = 50;

function applyFilters(
  query: any,
  params: {
    dateFrom?: string;
    dateTo?: string;
    eventType?: string;
    category?: string;
    authAction?: string;
    severity?: string;
    pathname?: string;
    search?: string;
  }
) {
  let next = query;
  if (params.dateFrom) next = next.gte("created_at", `${params.dateFrom}T00:00:00+07:00`);
  if (params.dateTo) next = next.lte("created_at", `${params.dateTo}T23:59:59.999+07:00`);
  const category = normalizeUiEventLogCategory(params.category);
  const categoryTypes = getUiEventLogTypesForCategory(category);
  if (categoryTypes?.length) next = next.in("event_type", categoryTypes);
  if (category === "errors") next = next.or("event_type.eq.client_error,severity.in.(warning,error)");
  if (params.eventType && params.eventType !== "all") next = next.eq("event_type", params.eventType);
  if (params.authAction && params.authAction !== "all") {
    next = next.eq("event_type", "auth_activity").eq("event_name", params.authAction);
  }
  if (params.severity && params.severity !== "all") next = next.eq("severity", params.severity);
  if (params.pathname) next = next.ilike("pathname", `%${params.pathname}%`);
  if (params.search) {
    const safe = params.search.replace(/,/g, " ");
    next = next.or(
      `actor_name.ilike.%${safe}%,actor_email.ilike.%${safe}%,event_name.ilike.%${safe}%,message.ilike.%${safe}%,pathname.ilike.%${safe}%`
    );
  }
  return next;
}

function shapeUiEventLogRows(rows: any[]) {
  return rows.map((row) => ({
    ...row,
    category: resolveUiEventLogCategory(row.event_type, row.severity),
    archive_status: getUiEventLogArchiveStatus(row.archived_at, row.created_at),
  }));
}

async function deleteUiEventLogsInChunks(supabase: any, ids: string[]) {
  let deletedCount = 0;

  for (let index = 0; index < ids.length; index += EXPLICIT_DELETE_CHUNK_SIZE) {
    const chunk = ids.slice(index, index + EXPLICIT_DELETE_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const { error } = await supabase
      .from("ui_event_logs")
      .delete()
      .in("id", chunk);
    if (error) {
      return { success: false as const, error };
    }
    deletedCount += chunk.length;
  }

  return { success: true as const, deletedCount };
}

async function deleteFilteredUiEventLogsInBatches(
  supabase: any,
  params: {
    dateFrom?: string;
    dateTo?: string;
    eventType?: string;
    category?: string;
    authAction?: string;
    severity?: string;
    pathname?: string;
    search?: string;
  }
) {
  let deletedCount = 0;

  for (let batchIndex = 0; batchIndex < FILTERED_DELETE_MAX_BATCHES; batchIndex += 1) {
    const { data, error } = await applyFilters(
      supabase
        .from("ui_event_logs")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(FILTERED_DELETE_PAGE_SIZE),
      params
    );
    if (error) {
      return { success: false as const, error };
    }

    const batchIds = (data ?? []).map((row: { id: string }) => row.id);
    if (batchIds.length === 0) {
      return { success: true as const, deletedCount, partial: false };
    }

    const deleteResult = await deleteUiEventLogsInChunks(supabase, batchIds);
    if (!deleteResult.success) {
      return deleteResult;
    }

    deletedCount += deleteResult.deletedCount;
    if (batchIds.length < FILTERED_DELETE_PAGE_SIZE) {
      return { success: true as const, deletedCount, partial: false };
    }
  }

  return { success: true as const, deletedCount, partial: true };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(200, Math.max(20, Number.parseInt(searchParams.get("per_page") ?? "50", 10) || 50));
  const dateFrom = String(searchParams.get("date_from") ?? "").trim();
  const dateTo = String(searchParams.get("date_to") ?? "").trim();
  const eventType = String(searchParams.get("event_type") ?? "all").trim();
  const category = String(searchParams.get("category") ?? "all").trim();
  const authAction = String(searchParams.get("auth_action") ?? "all").trim();
  const severity = String(searchParams.get("severity") ?? "all").trim();
  const pathname = String(searchParams.get("pathname") ?? "").trim();
  const search = String(searchParams.get("search") ?? "").trim();

  const baseQuery = applyFilters(
    auth.supabase.from("ui_event_logs").select("*", { count: "exact" }),
    { dateFrom, dateTo, eventType, category, authAction, severity, pathname, search }
  );

  const { data, error, count } = await baseQuery
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data: settingsRow, error: settingsError } = await auth.supabase
    .from("hotel_settings")
    .select("ui_event_log_capture_emails")
    .eq("id", 1)
    .maybeSingle();

  if (error || settingsError) {
    return NextResponse.json(
      { success: false, error: error?.message || settingsError?.message || "Failed to load activity logs." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    rows: shapeUiEventLogRows((data ?? []) as any[]),
    settings: {
      capture_emails: serializeUiEventLogCaptureEmails(settingsRow?.ui_event_log_capture_emails),
    },
    pagination: {
      page,
      per_page: perPage,
      total: Number(count ?? 0),
      total_pages: Math.max(1, Math.ceil(Number(count ?? 0) / perPage)),
    },
  });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const parsed = deleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  if (parsed.data.delete_filtered) {
    const deleteResult = await deleteFilteredUiEventLogsInBatches(
      auth.supabase,
      {
        dateFrom: parsed.data.date_from,
        dateTo: parsed.data.date_to,
        eventType: parsed.data.event_type,
        category: parsed.data.category,
        authAction: parsed.data.auth_action,
        severity: parsed.data.severity,
        pathname: parsed.data.pathname,
        search: parsed.data.search,
      }
    );
    if (!deleteResult.success) {
      return NextResponse.json({ success: false, error: deleteResult.error.message }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      deleted_count: deleteResult.deletedCount,
      partial: deleteResult.partial ?? false,
    });
  }

  const targetIds = parsed.data.ids ?? [];
  if (targetIds.length === 0) {
    return NextResponse.json({ success: true, deleted_count: 0 });
  }

  const deleteResult = await deleteUiEventLogsInChunks(auth.supabase, targetIds);
  if (!deleteResult.success) {
    return NextResponse.json({ success: false, error: deleteResult.error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, deleted_count: deleteResult.deletedCount });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminRouteAccess(request);
  if (!auth.ok) return auth.response;

  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Invalid payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const captureEmails = serializeUiEventLogCaptureEmails(parsed.data.capture_emails);
  const { error } = await auth.supabase
    .from("hotel_settings")
    .upsert({
      id: 1,
      ui_event_log_capture_emails: captureEmails,
      updated_at: new Date().toISOString(),
    });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    settings: {
      capture_emails: captureEmails,
    },
  });
}
