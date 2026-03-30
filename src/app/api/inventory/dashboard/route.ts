import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const querySchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function thailandDateString(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function deriveFloorNumber(roomNumber: string | null | undefined): number | null {
  const normalized = String(roomNumber ?? "").trim();
  if (!normalized) return null;
  const firstDigit = normalized.slice(0, 1);
  const value = Number(firstDigit);
  if (!Number.isInteger(value) || value <= 0) return null;
  return value;
}

function toBooleanLike(value: unknown, fallback = true): boolean {
  if (value === true || value === "true" || value === "t" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === "f" || value === 0 || value === "0") return false;
  return fallback;
}

function isDashboardVisibilityColumnMissing(error: { message?: string | null } | null): boolean {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("show_on_inventory_dashboard");
}

export async function GET(request: NextRequest) {
  try {
    const parsed = querySchema.safeParse({
      date_from: request.nextUrl.searchParams.get("date_from") ?? undefined,
      date_to: request.nextUrl.searchParams.get("date_to") ?? undefined,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: "Invalid query.", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const today = thailandDateString();
    const dateFrom = parsed.data.date_from ?? today;
    const dateTo = parsed.data.date_to ?? today;

    const supabase = createServerSupabaseClient();

    const [
      { data: mainStocksRaw, error: mainErrorRaw },
      { data: floorStocksRaw, error: floorErrorRaw },
      { data: txRows, error: txError },
    ] = await Promise.all([
      supabase
        .from("main_stock")
        .select(
          "id, product_id, quantity, reorder_level, updated_at, products(name, category, unit, is_active, show_on_inventory_dashboard)"
        )
        .order("updated_at", { ascending: false }),
      supabase
        .from("floor_stock")
        .select(
          "id, floor_number, product_id, quantity, updated_at, products(name, category, unit, is_active, show_on_inventory_dashboard)"
        )
        .order("floor_number", { ascending: true }),
      supabase
        .from("stock_transactions_v2")
        .select(
          "id, transaction_date, product_id, action, quantity_change, floor_number, room_number, note, products(name, category, unit, is_active)"
        )
        .gte("transaction_date", dateFrom)
        .lte("transaction_date", dateTo)
        .order("created_at", { ascending: false }),
    ]);

    let mainStocks = (mainStocksRaw as any[] | null) ?? null;
    let floorStocks = (floorStocksRaw as any[] | null) ?? null;
    let mainError = mainErrorRaw;
    let floorError = floorErrorRaw;
    let visibilityColumnAvailable = true;

    if (
      (mainError && isDashboardVisibilityColumnMissing(mainError)) ||
      (floorError && isDashboardVisibilityColumnMissing(floorError))
    ) {
      visibilityColumnAvailable = false;
      const [mainFallback, floorFallback] = await Promise.all([
        supabase
          .from("main_stock")
          .select("id, product_id, quantity, reorder_level, updated_at, products(name, category, unit, is_active)")
          .order("updated_at", { ascending: false }),
        supabase
          .from("floor_stock")
          .select("id, floor_number, product_id, quantity, updated_at, products(name, category, unit, is_active)")
          .order("floor_number", { ascending: true }),
      ]);
      mainStocks = (mainFallback.data as any[] | null) ?? null;
      floorStocks = (floorFallback.data as any[] | null) ?? null;
      mainError = mainFallback.error;
      floorError = floorFallback.error;
    }

    if (mainError) {
      const message = String(mainError.message ?? "").toLowerCase();
      if (message.includes("show_on_inventory_dashboard")) {
        return NextResponse.json(
          {
            success: false,
            error:
              "DB migration required: apply 20260303_phase11_inventory_dashboard_visibility.sql before using inventory dashboard.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: false, error: mainError.message }, { status: 500 });
    }
    if (floorError) {
      const message = String(floorError.message ?? "").toLowerCase();
      if (message.includes("show_on_inventory_dashboard")) {
        return NextResponse.json(
          {
            success: false,
            error:
              "DB migration required: apply 20260303_phase11_inventory_dashboard_visibility.sql before using inventory dashboard.",
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: false, error: floorError.message }, { status: 500 });
    }
    if (txError) return NextResponse.json({ success: false, error: txError.message }, { status: 500 });

    const mainRows = (mainStocks ?? []).map((row: any) => {
      const product = Array.isArray(row.products) ? row.products[0] ?? null : row.products ?? null;
      return {
        id: row.id,
        product_id: row.product_id,
        product_name: product?.name ?? null,
        category: product?.category ?? null,
        unit: product?.unit ?? null,
        is_active: toBooleanLike(product?.is_active, false),
        show_on_inventory_dashboard: visibilityColumnAvailable
          ? toBooleanLike(product?.show_on_inventory_dashboard, true)
          : true,
        quantity: Number(row.quantity ?? 0),
        reorder_level: Number(row.reorder_level ?? 0),
        updated_at: row.updated_at,
        is_low_stock: Number(row.quantity ?? 0) <= Number(row.reorder_level ?? 0),
      };
    });

    const floorRows = (floorStocks ?? []).map((row: any) => {
      const product = Array.isArray(row.products) ? row.products[0] ?? null : row.products ?? null;
      return {
        id: row.id,
        floor_number: Number(row.floor_number ?? 0),
        product_id: row.product_id,
        product_name: product?.name ?? null,
        category: product?.category ?? null,
        unit: product?.unit ?? null,
        is_active: toBooleanLike(product?.is_active, false),
        show_on_inventory_dashboard: visibilityColumnAvailable
          ? toBooleanLike(product?.show_on_inventory_dashboard, true)
          : true,
        quantity: Number(row.quantity ?? 0),
        updated_at: row.updated_at,
      };
    });

    const txList = (txRows ?? []).map((row: any) => ({
      id: row.id,
      transaction_date: row.transaction_date,
      product_id: row.product_id,
      product_name: row.products?.name ?? null,
      product_category: row.products?.category ?? null,
      product_unit: row.products?.unit ?? null,
      product_is_active: toBooleanLike(row.products?.is_active, true),
      action: row.action,
      quantity_change: Number(row.quantity_change ?? 0),
      floor_number: row.floor_number ?? null,
      room_number: row.room_number ?? null,
      note: row.note ?? null,
    }));

    const visibleMainRows = mainRows.filter((row) => row.is_active);
    const visibleFloorRows = floorRows.filter(
      (row) => row.is_active && String(row.category ?? "").trim().toLowerCase() !== "pos"
    );
    const visibleTxList = txList.filter((row) => row.product_is_active);

    const byAction = visibleTxList.reduce<Record<string, number>>((acc, tx) => {
      acc[tx.action] = (acc[tx.action] ?? 0) + 1;
      return acc;
    }, {});

    const byFloor = visibleFloorRows.reduce<Record<string, { floor_number: number; distinct_products: number; total_units: number }>>(
      (acc, row) => {
        const key = String(row.floor_number);
        if (!acc[key]) {
          acc[key] = { floor_number: row.floor_number, distinct_products: 0, total_units: 0 };
        }
        acc[key].distinct_products += 1;
        acc[key].total_units += row.quantity;
        return acc;
      },
      {}
    );

    const usageByRoom = visibleTxList
      .filter((row) => row.action === "use" && row.room_number)
      .reduce<Record<string, { room_number: string; usage_count: number; units_used: number }>>((acc, tx) => {
        const roomNumber = String(tx.room_number);
        if (!acc[roomNumber]) {
          acc[roomNumber] = { room_number: roomNumber, usage_count: 0, units_used: 0 };
        }
        acc[roomNumber].usage_count += 1;
        acc[roomNumber].units_used += Math.abs(Number(tx.quantity_change ?? 0));
        return acc;
      }, {});

    const roomUsageTop = Object.values(usageByRoom)
      .sort((a, b) => b.units_used - a.units_used)
      .slice(0, 10);

    const usageByProductAndRoom = visibleTxList
      .filter((row) => row.action === "use" && row.room_number)
      .reduce<
        Record<
          string,
          {
            product_id: string | null;
            product_name: string | null;
            category: string | null;
            unit: string | null;
            room_number: string;
            floor_number: number | null;
            usage_count: number;
            units_used: number;
          }
        >
      >((acc, tx) => {
        const roomNumber = String(tx.room_number ?? "").trim();
        if (!roomNumber) return acc;

        const inferredFloor =
          typeof tx.floor_number === "number" && Number.isFinite(tx.floor_number)
            ? Number(tx.floor_number)
            : deriveFloorNumber(roomNumber);
        const floorNumber =
          typeof inferredFloor === "number" && Number.isFinite(inferredFloor) ? inferredFloor : null;

        const productKey = String(tx.product_id ?? "unknown");
        const key = `${productKey}::${roomNumber}::${floorNumber ?? "na"}`;

        if (!acc[key]) {
          acc[key] = {
            product_id: tx.product_id ?? null,
            product_name: tx.product_name ?? null,
            category: tx.product_category ?? null,
            unit: tx.product_unit ?? null,
            room_number: roomNumber,
            floor_number: floorNumber,
            usage_count: 0,
            units_used: 0,
          };
        }

        acc[key].usage_count += 1;
        acc[key].units_used += Math.abs(Number(tx.quantity_change ?? 0));
        return acc;
      }, {});

    const productUsageEntries = Object.values(usageByProductAndRoom).sort((a, b) => {
      const catA = String(a.category ?? "").toLowerCase();
      const catB = String(b.category ?? "").toLowerCase();
      if (catA !== catB) return catA.localeCompare(catB);
      const nameA = String(a.product_name ?? "").toLowerCase();
      const nameB = String(b.product_name ?? "").toLowerCase();
      if (nameA !== nameB) return nameA.localeCompare(nameB);
      if (b.units_used !== a.units_used) return b.units_used - a.units_used;
      return String(a.room_number).localeCompare(String(b.room_number), undefined, { numeric: true });
    });

    const lowStockItems = visibleMainRows.filter((row) => row.is_low_stock);
    const floorStockDetails = visibleFloorRows
      .filter((row) => row.show_on_inventory_dashboard)
      .map((row) => ({
        floor_number: row.floor_number,
        product_id: row.product_id,
        product_name: row.product_name,
        category: row.category,
        unit: row.unit,
        quantity: row.quantity,
        updated_at: row.updated_at,
      }))
      .sort((a, b) => {
        if (a.floor_number !== b.floor_number) return a.floor_number - b.floor_number;
        return String(a.product_name ?? "").localeCompare(String(b.product_name ?? ""), undefined, {
          numeric: true,
        });
      });

    return NextResponse.json({
      success: true,
      range: { date_from: dateFrom, date_to: dateTo },
      summary: {
        main_products: visibleMainRows.length,
        floor_stock_rows: visibleFloorRows.length,
        low_stock_count: lowStockItems.length,
        transactions_count: visibleTxList.length,
      },
      low_stock_items: lowStockItems,
      floor_overview: Object.values(byFloor).sort((a, b) => a.floor_number - b.floor_number),
      floor_stock_details: floorStockDetails,
      transactions_by_action: byAction,
      top_room_usage: roomUsageTop,
      product_usage_entries: productUsageEntries,
    });
  } catch (err) {
    console.error("inventory/dashboard GET failed", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
