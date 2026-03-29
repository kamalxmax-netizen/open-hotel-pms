import { NextRequest, NextResponse } from "next/server";
import { requireAdminRouteAccess } from "@/lib/guest-migration";

const CONFIRM_TEXT = "DELETE_ALL_GUEST_AND_BOOKING_DATA";
const AUDIT_ENTITY_TYPES = ["reservation", "guest_profile", "folio", "tax_invoice"];

type DeleteTask = {
  key: string;
  table: string;
  apply?: (query: any) => any;
};

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const anyError = error as { code?: string; message?: string };
  if (anyError.code === "42P01") return true;
  const message = String(anyError.message ?? "").toLowerCase();
  return message.includes("does not exist") || message.includes("relation") || message.includes("not found") || message.includes("could not find");
}

async function safeCount(supabase: any, task: DeleteTask): Promise<number> {
  let query = supabase.from(task.table).select("*", { count: "exact", head: true });
  if (task.apply) query = task.apply(query);
  const { count, error } = await query;
  if (error) {
    if (isMissingRelationError(error)) return 0;
    throw new Error(`${task.table} count failed: ${error.message}`);
  }
  return Number(count ?? 0);
}

async function safeDelete(supabase: any, task: DeleteTask): Promise<void> {
  let query = supabase.from(task.table).delete();
  if (task.apply) query = task.apply(query);
  const { error } = await query;
  if (error) {
    if (isMissingRelationError(error)) return;
    throw new Error(`${task.table} delete failed: ${error.message}`);
  }
}

async function listAllPathsInBucket(supabase: any, bucketName: string): Promise<string[]> {
  const queue: string[] = [""];
  const files: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    if (visited.has(current)) continue;
    visited.add(current);

    const { data, error } = await supabase.storage.from(bucketName).list(current, { limit: 1000 });
    if (error) {
      if (String(error.message ?? "").toLowerCase().includes("not found")) return files;
      throw new Error(`Storage list failed at "${current}": ${error.message}`);
    }

    for (const entry of data ?? []) {
      const fullPath = current ? `${current}/${entry.name}` : entry.name;
      const isFile = Boolean((entry as any).id) || Boolean((entry as any).metadata);
      if (isFile) {
        files.push(fullPath);
      } else {
        queue.push(fullPath);
      }
    }
  }

  return files;
}

function buildDeleteTasks(): DeleteTask[] {
  return [
    { key: "tax_invoice_items", table: "tax_invoice_items" },
    { key: "tax_invoices", table: "tax_invoices" },
    { key: "invoices", table: "invoices" },
    { key: "receipts", table: "receipts" },
    { key: "folio_payments", table: "folio_payments" },
    { key: "reservation_guests", table: "reservation_guests" },
    { key: "passport_scans", table: "passport_scans" },
    { key: "group_checkin_wizard_drafts", table: "group_checkin_wizard_drafts" },
    { key: "reservation_nights", table: "reservation_nights" },
    { key: "reservation_preferences", table: "reservation_preferences" },
    { key: "reservation_room_plans", table: "reservation_room_plans" },
    { key: "reservation_alerts", table: "reservation_alerts" },
    { key: "reservation_traces", table: "reservation_traces" },
    { key: "pos_orders", table: "pos_orders" },
    { key: "audit_logs", table: "audit_logs", apply: (query) => query.in("entity_type", AUDIT_ENTITY_TYPES) },
    { key: "reservations", table: "reservations" },
    { key: "booking_groups", table: "booking_groups" },
    { key: "guest_tax_profiles", table: "guest_tax_profiles" },
    { key: "legacy_stays", table: "legacy_stays" },
    { key: "guest_profiles", table: "guest_profiles" },
  ];
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminRouteAccess(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => ({}));
    const confirm = String(body?.confirm ?? "").trim();
    const dryRun = body?.dry_run !== false;

    if (!dryRun && confirm !== CONFIRM_TEXT) {
      return NextResponse.json(
        { success: false, error: `Invalid confirm text. Use "${CONFIRM_TEXT}".` },
        { status: 400 }
      );
    }

    const deleteTasks = buildDeleteTasks();
    const deleted: Record<string, number> = {};

    for (const task of deleteTasks) {
      deleted[task.key] = await safeCount(auth.supabase, task);
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dry_run: true,
        deleted,
      });
    }

    for (const task of deleteTasks) {
      await safeDelete(auth.supabase, task);
    }

    // Storage cleanup for passport OCR images (full bucket traversal)
    const storagePaths = await listAllPathsInBucket(auth.supabase, "passport-photos");
    for (let i = 0; i < storagePaths.length; i += 100) {
      const chunk = storagePaths.slice(i, i + 100);
      const { error } = await auth.supabase.storage.from("passport-photos").remove(chunk);
      if (error) {
        throw new Error(`Storage cleanup failed: ${error.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      dry_run: false,
      deleted: {
        ...deleted,
        passport_photos_storage_files: storagePaths.length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup failed.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
