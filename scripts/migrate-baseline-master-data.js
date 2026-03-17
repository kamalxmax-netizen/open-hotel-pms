#!/usr/bin/env node

/**
 * Baseline Setup Data Migration (Old Supabase -> New Supabase)
 *
 * Source defaults from .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Target must be provided via env:
 *   TARGET_SUPABASE_URL
 *   TARGET_SUPABASE_SERVICE_ROLE_KEY
 *
 * Usage:
 *   node scripts/migrate-baseline-master-data.js --dry-run
 *   TARGET_SUPABASE_URL=... TARGET_SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-baseline-master-data.js --apply
 */

const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

actionMain().catch((error) => {
  console.error("\n[FAIL]", error?.message || error);
  process.exit(1);
});

async function actionMain() {
  const args = new Set(process.argv.slice(2));
  const isDryRun = args.has("--dry-run") || !args.has("--apply");

  const sourceUrl = process.env.SOURCE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const sourceKey = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const targetUrl = process.env.TARGET_SUPABASE_URL;
  const targetKey = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;

  if (!sourceUrl || !sourceKey) {
    throw new Error("Missing source Supabase credentials from .env.local (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
  if (!targetUrl || !targetKey) {
    throw new Error("Missing target Supabase credentials (TARGET_SUPABASE_URL / TARGET_SUPABASE_SERVICE_ROLE_KEY)");
  }
  if (normalizeUrl(sourceUrl) === normalizeUrl(targetUrl)) {
    throw new Error("Source and target Supabase URL are the same. Abort to prevent self-overwrite.");
  }

  const source = createClient(sourceUrl, sourceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-migration-source": "baseline-master-data" } },
  });
  const target = createClient(targetUrl, targetKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-migration-target": "baseline-master-data" } },
  });

  console.log("[INFO] Mode:", isDryRun ? "DRY-RUN" : "APPLY");
  console.log("[INFO] Source:", sourceUrl);
  console.log("[INFO] Target:", targetUrl);
  console.log("[INFO] Scope: baseline/master setup tables only (NO profiles, NO reservation transactions)");

  const state = {
    sourceRoomTypesById: new Map(),
    targetRoomTypeIdByCode: new Map(),
    sourceRoomNumberById: new Map(),
    targetRoomIdByNumber: new Map(),
    sourceProductKeyById: new Map(),
    targetProductIdByKey: new Map(),
    sourceRatePlanCodeById: new Map(),
    targetRatePlanIdByCode: new Map(),
    sourceCompanyNameById: new Map(),
    targetCompanyIdByName: new Map(),
    sourcePierKeyById: new Map(),
    targetPierIdByKey: new Map(),
    sourceDriverKeyById: new Map(),
    targetDriverIdByKey: new Map(),
  };

  const summary = [];

  const run = async (label, fn) => {
    const result = await fn();
    summary.push({ label, source: result.sourceCount || 0, migrated: result.migratedCount || 0, skipped: result.skippedCount || 0 });
  };

  await run("hotel_settings", () => migrateHotelSettings(source, target, isDryRun));
  await run("departments", () => migrateSimpleByConflict(source, target, {
    table: "departments",
    columns: ["code", "name", "line_group_id", "is_active"],
    onConflict: "code",
  }, isDryRun));

  await run("room_types", () => migrateRoomTypes(source, target, state, isDryRun));
  await run("rooms", () => migrateRooms(source, target, state, isDryRun));
  await run("room_layouts", () => migrateRoomLayouts(source, target, state, isDryRun));

  await run("room_features", () => migrateSimpleByConflict(source, target, {
    table: "room_features",
    columns: ["code", "name", "category"],
    onConflict: "code",
  }, isDryRun));
  await run("room_feature_mapping", () => migrateRoomFeatureMapping(source, target, state, isDryRun));

  await run("bed_types", () => migrateSimpleByConflict(source, target, {
    table: "bed_types",
    columns: ["code", "name", "width_ft"],
    onConflict: "code",
  }, isDryRun));
  await run("room_beds", () => migrateRoomBeds(source, target, state, isDryRun));
  await run("room_detail", () => migrateRoomDetail(source, target, state, isDryRun));

  await run("condition_deduction_templates", () => migrateSimpleByConflict(source, target, {
    table: "condition_deduction_templates",
    columns: ["category", "label", "deduct_points", "is_active"],
    onConflict: "category,label",
  }, isDryRun));
  await run("scoring_config", () => migrateSimpleByConflict(source, target, {
    table: "scoring_config",
    columns: ["key", "value", "label"],
    onConflict: "key",
  }, isDryRun));

  await run("products", () => migrateProducts(source, target, state, isDryRun));
  await run("checklist_templates", () => migrateChecklistTemplates(source, target, state, isDryRun));
  await run("extra_task_templates", () => migrateSimpleByConflict(source, target, {
    table: "extra_task_templates",
    columns: ["name", "duration_min", "category", "is_active"],
    onConflict: "name",
  }, isDryRun));

  await run("loan_items", () => migrateSimpleByConflict(source, target, {
    table: "loan_items",
    columns: [
      "code",
      "name",
      "total_qty",
      "available",
      "icon",
      "requires_hk_collection",
      "requires_extra_charge_reminder",
      "linked_fee_template_code",
    ],
    onConflict: "code",
  }, isDryRun));

  await run("extra_fee_templates", () => migrateSimpleByConflict(source, target, {
    table: "extra_fee_templates",
    columns: ["code", "name", "default_price", "category", "icon", "is_active", "sort_order"],
    onConflict: "code",
  }, isDryRun));

  await run("alert_codes", () => migrateSimpleByConflict(source, target, {
    table: "alert_codes",
    columns: ["code", "description", "dept", "auto_on_co", "icon"],
    onConflict: "code",
  }, isDryRun));

  await run("alert_templates", () => migrateSimpleByConflict(source, target, {
    table: "alert_templates",
    columns: ["code", "name", "description", "category", "display_surfaces", "severity", "is_system", "is_active", "sort_order", "icon"],
    onConflict: "code",
  }, isDryRun));

  await run("trace_templates", () => migrateTraceTemplates(source, target, isDryRun));

  await run("rate_plans", () => migrateRatePlans(source, target, state, isDryRun));
  await run("rate_plan_tiers", () => migrateRatePlanTiers(source, target, state, isDryRun));

  await run("boat_companies", () => migrateBoatCompanies(source, target, state, isDryRun));
  await run("boat_piers", () => migrateBoatPiers(source, target, state, isDryRun));
  await run("boat_routes", () => migrateBoatRoutes(source, target, state, isDryRun));
  await run("drivers", () => migrateDrivers(source, target, state, isDryRun));
  await run("vehicles", () => migrateVehicles(source, target, state, isDryRun));

  console.log("\n[SUMMARY]");
  for (const row of summary) {
    console.log(`${row.label.padEnd(30)} source=${String(row.source).padStart(4)}  migrated=${String(row.migrated).padStart(4)}  skipped=${String(row.skipped).padStart(4)}`);
  }

  if (isDryRun) {
    console.log("\n[DRY-RUN COMPLETE] Re-run with --apply to write data to target.");
  } else {
    console.log("\n[APPLY COMPLETE] Baseline setup data migration finished.");
  }
}

function normalizeUrl(url) {
  return String(url).trim().replace(/\/$/, "").toLowerCase();
}

async function fetchAll(client, table, columns = "*") {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    const { data, error } = await client.from(table).select(columns).range(from, to);
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function sanitize(row, allowedColumns) {
  const out = {};
  for (const col of allowedColumns) {
    if (Object.prototype.hasOwnProperty.call(row, col)) out[col] = row[col];
  }
  return out;
}

async function upsertRows(target, table, rows, onConflict, isDryRun) {
  if (!rows.length) return;
  if (isDryRun) return;
  const chunk = 400;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const { error } = await target.from(table).upsert(part, { onConflict });
    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }
  }
}

async function migrateHotelSettings(source, target, isDryRun) {
  const rows = await fetchAll(source, "hotel_settings", "*");
  if (!rows.length) return { sourceCount: 0, migratedCount: 0, skippedCount: 0 };
  const payload = rows.map((row) => {
    const copy = { ...row };
    delete copy.updated_at;
    return copy;
  });
  await upsertRows(target, "hotel_settings", payload, "id", isDryRun);
  return { sourceCount: rows.length, migratedCount: payload.length, skippedCount: 0 };
}

async function migrateSimpleByConflict(source, target, cfg, isDryRun) {
  const rows = await fetchAll(source, cfg.table, cfg.columns.join(","));
  const payload = rows.map((row) => sanitize(row, cfg.columns));
  await upsertRows(target, cfg.table, payload, cfg.onConflict, isDryRun);
  return { sourceCount: rows.length, migratedCount: payload.length, skippedCount: 0 };
}

async function migrateRoomTypes(source, target, state, isDryRun) {
  const cols = [
    "id",
    "code",
    "name_en",
    "name_local",
    "sort_order",
    "max_guests",
    "extra_guest_charge",
    "child_free_under_cm",
    "child_extra_charge",
    "cleaning_duration_min",
  ];
  const sourceRows = await fetchAll(source, "room_types", cols.join(","));
  for (const row of sourceRows) {
    state.sourceRoomTypesById.set(String(row.id), row.code);
  }

  const payload = sourceRows.map((row) => sanitize(row, cols.filter((c) => c !== "id")));
  await upsertRows(target, "room_types", payload, "code", isDryRun);

  const targetRows = await fetchAll(target, "room_types", "id,code");
  for (const row of targetRows) {
    state.targetRoomTypeIdByCode.set(row.code, row.id);
  }

  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: 0 };
}

async function migrateRooms(source, target, state, isDryRun) {
  const cols = [
    "id",
    "room_number",
    "room_type_id",
    "is_sellable",
    "is_visible_on_board",
    "closure_reason",
    "sort_order",
    "floor_number",
    "wing",
    "is_dayuse",
  ];
  const sourceRows = await fetchAll(source, "rooms", cols.join(","));

  const payload = [];
  let skipped = 0;
  for (const row of sourceRows) {
    const roomTypeCode = state.sourceRoomTypesById.get(String(row.room_type_id));
    const mappedRoomTypeId = roomTypeCode ? state.targetRoomTypeIdByCode.get(roomTypeCode) : null;
    if (!mappedRoomTypeId) {
      skipped += 1;
      continue;
    }
    payload.push({
      room_number: row.room_number,
      room_type_id: mappedRoomTypeId,
      is_sellable: row.is_sellable,
      is_visible_on_board: row.is_visible_on_board,
      closure_reason: row.closure_reason,
      sort_order: row.sort_order,
      floor_number: row.floor_number,
      wing: row.wing,
      is_dayuse: row.is_dayuse,
    });
    state.sourceRoomNumberById.set(String(row.id), String(row.room_number));
  }

  await upsertRows(target, "rooms", payload, "room_number", isDryRun);

  const targetRows = await fetchAll(target, "rooms", "id,room_number");
  for (const row of targetRows) {
    state.targetRoomIdByNumber.set(String(row.room_number), row.id);
  }

  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

async function migrateRoomLayouts(source, target, state, isDryRun) {
  const cols = ["room_id", "view_type", "grid_x", "grid_y", "zone", "sort_order"];
  const sourceRows = await fetchAll(source, "room_layouts", cols.join(","));
  const payload = [];
  let skipped = 0;
  for (const row of sourceRows) {
    const roomNumber = state.sourceRoomNumberById.get(String(row.room_id));
    const targetRoomId = roomNumber ? state.targetRoomIdByNumber.get(roomNumber) : null;
    if (!targetRoomId) {
      skipped += 1;
      continue;
    }
    payload.push({
      room_id: targetRoomId,
      view_type: row.view_type,
      grid_x: row.grid_x,
      grid_y: row.grid_y,
      zone: row.zone,
      sort_order: row.sort_order,
    });
  }
  await upsertRows(target, "room_layouts", payload, "room_id,view_type", isDryRun);
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

async function migrateRoomFeatureMapping(source, target, state, isDryRun) {
  const sourceRows = await fetchAll(source, "room_feature_mapping", "room_id,feature_code");
  const payload = [];
  let skipped = 0;
  for (const row of sourceRows) {
    const roomNumber = state.sourceRoomNumberById.get(String(row.room_id));
    const targetRoomId = roomNumber ? state.targetRoomIdByNumber.get(roomNumber) : null;
    if (!targetRoomId) {
      skipped += 1;
      continue;
    }
    payload.push({ room_id: targetRoomId, feature_code: row.feature_code });
  }
  await upsertRows(target, "room_feature_mapping", payload, "room_id,feature_code", isDryRun);
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

async function migrateRoomBeds(source, target, state, isDryRun) {
  const sourceRows = await fetchAll(source, "room_beds", "room_id,bed_type_code,quantity");
  const payload = [];
  let skipped = 0;
  for (const row of sourceRows) {
    const roomNumber = state.sourceRoomNumberById.get(String(row.room_id));
    const targetRoomId = roomNumber ? state.targetRoomIdByNumber.get(roomNumber) : null;
    if (!targetRoomId) {
      skipped += 1;
      continue;
    }
    payload.push({ room_id: targetRoomId, bed_type_code: row.bed_type_code, quantity: row.quantity });
  }
  await upsertRows(target, "room_beds", payload, "room_id,bed_type_code", isDryRun);
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

async function migrateRoomDetail(source, target, state, isDryRun) {
  const cols = [
    "room_id",
    "ac_base",
    "furniture_base",
    "bathroom_base",
    "wifi_base",
    "ac_deduct",
    "furniture_deduct",
    "bathroom_deduct",
    "wifi_deduct",
    "ac_model",
    "last_renovated",
    "tv_size_inch",
    "floor_number",
    "extra_notes",
  ];
  const sourceRows = await fetchAll(source, "room_detail", cols.join(","));
  const payload = [];
  let skipped = 0;
  for (const row of sourceRows) {
    const roomNumber = state.sourceRoomNumberById.get(String(row.room_id));
    const targetRoomId = roomNumber ? state.targetRoomIdByNumber.get(roomNumber) : null;
    if (!targetRoomId) {
      skipped += 1;
      continue;
    }
    payload.push({ ...sanitize(row, cols), room_id: targetRoomId });
  }
  await upsertRows(target, "room_detail", payload, "room_id", isDryRun);
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

function productNaturalKey(row) {
  if (row.sku && String(row.sku).trim()) return `sku:${String(row.sku).trim().toLowerCase()}`;
  return `name:${String(row.name || "").trim().toLowerCase()}`;
}

async function migrateProducts(source, target, state, isDryRun) {
  const cols = ["id", "name", "sku", "category", "unit", "sale_price", "is_active"];
  const sourceRows = await fetchAll(source, "products", cols.join(","));

  for (const row of sourceRows) {
    state.sourceProductKeyById.set(String(row.id), productNaturalKey(row));
  }

  const payload = sourceRows.map((row) => sanitize(row, cols.filter((c) => c !== "id")));
  await upsertRows(target, "products", payload, "name", isDryRun);

  const targetRows = await fetchAll(target, "products", "id,name,sku");
  for (const row of targetRows) {
    state.targetProductIdByKey.set(productNaturalKey(row), row.id);
  }

  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: 0 };
}

async function migrateChecklistTemplates(source, target, state, isDryRun) {
  const cols = [
    "room_type_code",
    "item_name",
    "default_quantity",
    "category",
    "sort_order",
    "is_active",
    "product_id",
  ];
  const sourceRows = await fetchAll(source, "checklist_templates", cols.join(","));
  const payload = [];
  let skipped = 0;

  for (const row of sourceRows) {
    let mappedProductId = null;
    if (row.product_id) {
      const sourceKey = state.sourceProductKeyById.get(String(row.product_id));
      mappedProductId = sourceKey ? state.targetProductIdByKey.get(sourceKey) || null : null;
    }

    if (row.product_id && !mappedProductId) {
      skipped += 1;
      continue;
    }

    payload.push({
      room_type_code: row.room_type_code,
      item_name: row.item_name,
      default_quantity: row.default_quantity,
      category: row.category,
      sort_order: row.sort_order,
      is_active: row.is_active,
      product_id: mappedProductId,
    });
  }

  await upsertRows(target, "checklist_templates", payload, "room_type_code,item_name", isDryRun);
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

function traceTemplateKey(row) {
  return `${String(row.name || "").trim().toLowerCase()}|${String(row.dept || "").trim().toUpperCase()}|${String(row.template_text || "").trim().toLowerCase()}`;
}

async function migrateTraceTemplates(source, target, isDryRun) {
  const cols = ["name", "dept", "template_text", "is_active", "sort_order"];
  const sourceRows = await fetchAll(source, "trace_templates", cols.join(","));
  const targetRows = await fetchAll(target, "trace_templates", `id,${cols.join(",")}`);

  const targetByKey = new Map(targetRows.map((row) => [traceTemplateKey(row), row]));

  let inserted = 0;
  let updated = 0;

  for (const row of sourceRows) {
    const key = traceTemplateKey(row);
    const existing = targetByKey.get(key);

    if (isDryRun) {
      if (existing) updated += 1;
      else inserted += 1;
      continue;
    }

    if (existing) {
      const { error } = await target
        .from("trace_templates")
        .update({
          name: row.name,
          dept: row.dept,
          template_text: row.template_text,
          is_active: row.is_active,
          sort_order: row.sort_order,
        })
        .eq("id", existing.id);
      if (error) throw new Error(`trace_templates: ${error.message}`);
      updated += 1;
    } else {
      const { error } = await target.from("trace_templates").insert({
        name: row.name,
        dept: row.dept,
        template_text: row.template_text,
        is_active: row.is_active,
        sort_order: row.sort_order,
      });
      if (error) throw new Error(`trace_templates: ${error.message}`);
      inserted += 1;
    }
  }

  return {
    sourceCount: sourceRows.length,
    migratedCount: inserted + updated,
    skippedCount: 0,
  };
}

async function migrateRatePlans(source, target, state, isDryRun) {
  const cols = [
    "id",
    "code",
    "name_en",
    "name_th",
    "description",
    "discount_type",
    "discount_value",
    "min_nights",
    "max_nights",
    "valid_from",
    "valid_until",
    "is_active",
    "apply_to_room_types",
    "sort_order",
  ];
  const sourceRows = await fetchAll(source, "rate_plans", cols.join(","));

  for (const row of sourceRows) {
    state.sourceRatePlanCodeById.set(String(row.id), row.code);
  }

  const payload = sourceRows.map((row) => {
    const copy = sanitize(row, cols.filter((c) => c !== "id"));
    const mapped = [];
    const sourceTypeIds = Array.isArray(row.apply_to_room_types) ? row.apply_to_room_types : [];
    for (const sourceTypeId of sourceTypeIds) {
      const roomTypeCode = state.sourceRoomTypesById.get(String(sourceTypeId));
      const targetTypeId = roomTypeCode ? state.targetRoomTypeIdByCode.get(roomTypeCode) : null;
      if (targetTypeId) mapped.push(targetTypeId);
    }
    copy.apply_to_room_types = mapped.length ? mapped : null;
    return copy;
  });

  await upsertRows(target, "rate_plans", payload, "code", isDryRun);

  const targetRows = await fetchAll(target, "rate_plans", "id,code");
  for (const row of targetRows) {
    state.targetRatePlanIdByCode.set(row.code, row.id);
  }

  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: 0 };
}

async function migrateRatePlanTiers(source, target, state, isDryRun) {
  const sourceRows = await fetchAll(source, "rate_plan_tiers", "rate_plan_id,tier_code");
  const payload = [];
  let skipped = 0;
  for (const row of sourceRows) {
    const code = state.sourceRatePlanCodeById.get(String(row.rate_plan_id));
    const targetRatePlanId = code ? state.targetRatePlanIdByCode.get(code) : null;
    if (!targetRatePlanId) {
      skipped += 1;
      continue;
    }
    payload.push({ rate_plan_id: targetRatePlanId, tier_code: row.tier_code });
  }
  await upsertRows(target, "rate_plan_tiers", payload, "rate_plan_id,tier_code", isDryRun);
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

async function migrateBoatCompanies(source, target, state, isDryRun) {
  const cols = ["id", "name", "contact_phone", "contact_line", "contact_whatsapp", "website", "notes", "is_active"];
  const sourceRows = await fetchAll(source, "boat_companies", cols.join(","));
  for (const row of sourceRows) {
    state.sourceCompanyNameById.set(String(row.id), row.name);
  }
  const payload = sourceRows.map((row) => sanitize(row, cols.filter((c) => c !== "id")));
  await upsertRows(target, "boat_companies", payload, "name", isDryRun);
  const targetRows = await fetchAll(target, "boat_companies", "id,name");
  for (const row of targetRows) {
    state.targetCompanyIdByName.set(row.name, row.id);
  }
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: 0 };
}

function pierKey(companyName, pierName) {
  return `${String(companyName || "").trim().toLowerCase()}|${String(pierName || "").trim().toLowerCase()}`;
}

async function migrateBoatPiers(source, target, state, isDryRun) {
  const cols = ["id", "company_id", "name", "location_note", "sort_order", "is_active"];
  const sourceRows = await fetchAll(source, "boat_piers", cols.join(","));
  const payload = [];
  let skipped = 0;

  for (const row of sourceRows) {
    const companyName = state.sourceCompanyNameById.get(String(row.company_id));
    const targetCompanyId = companyName ? state.targetCompanyIdByName.get(companyName) : null;
    if (!targetCompanyId) {
      skipped += 1;
      continue;
    }
    payload.push({
      company_id: targetCompanyId,
      name: row.name,
      location_note: row.location_note,
      sort_order: row.sort_order,
      is_active: row.is_active,
    });

    state.sourcePierKeyById.set(String(row.id), pierKey(companyName, row.name));
  }

  await upsertRows(target, "boat_piers", payload, "company_id,name", isDryRun);

  const targetRows = await fetchAll(target, "boat_piers", "id,company_id,name");
  for (const row of targetRows) {
    const companyName = [...state.targetCompanyIdByName.entries()].find(([, id]) => id === row.company_id)?.[0] || "";
    state.targetPierIdByKey.set(pierKey(companyName, row.name), row.id);
  }

  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: skipped };
}

function routeKey(companyName, origin, destination, boatType, seasonLabel) {
  return `${String(companyName || "").trim().toLowerCase()}|${String(origin || "").trim().toLowerCase()}|${String(destination || "").trim().toLowerCase()}|${String(boatType || "").trim().toLowerCase()}|${String(seasonLabel || "").trim().toLowerCase()}`;
}

async function migrateBoatRoutes(source, target, state, isDryRun) {
  const cols = [
    "company_id",
    "departure_pier_id",
    "origin",
    "destination",
    "boat_type",
    "departure_times",
    "duration_minutes",
    "ticket_price",
    "cost_price",
    "includes_pickup",
    "pickup_fee",
    "season_label",
    "notes",
    "is_active",
  ];
  const sourceRows = await fetchAll(source, "boat_routes", cols.join(","));

  const targetExisting = await fetchAll(target, "boat_routes", `id,${cols.join(",")}`);
  const targetMap = new Map();
  for (const row of targetExisting) {
    const companyName = [...state.targetCompanyIdByName.entries()].find(([, id]) => id === row.company_id)?.[0] || "";
    targetMap.set(routeKey(companyName, row.origin, row.destination, row.boat_type, row.season_label), row.id);
  }

  let migrated = 0;
  let skipped = 0;

  for (const row of sourceRows) {
    const companyName = state.sourceCompanyNameById.get(String(row.company_id));
    const targetCompanyId = companyName ? state.targetCompanyIdByName.get(companyName) : null;
    if (!targetCompanyId) {
      skipped += 1;
      continue;
    }

    let targetDeparturePierId = null;
    if (row.departure_pier_id) {
      const sourcePierKey = state.sourcePierKeyById.get(String(row.departure_pier_id));
      targetDeparturePierId = sourcePierKey ? state.targetPierIdByKey.get(sourcePierKey) || null : null;
    }

    const key = routeKey(companyName, row.origin, row.destination, row.boat_type, row.season_label);
    const targetId = targetMap.get(key) || null;

    const payload = {
      company_id: targetCompanyId,
      departure_pier_id: targetDeparturePierId,
      origin: row.origin,
      destination: row.destination,
      boat_type: row.boat_type,
      departure_times: row.departure_times,
      duration_minutes: row.duration_minutes,
      ticket_price: row.ticket_price,
      cost_price: row.cost_price,
      includes_pickup: row.includes_pickup,
      pickup_fee: row.pickup_fee,
      season_label: row.season_label,
      notes: row.notes,
      is_active: row.is_active,
    };

    if (!isDryRun) {
      if (targetId) {
        const { error } = await target.from("boat_routes").update(payload).eq("id", targetId);
        if (error) throw new Error(`boat_routes: ${error.message}`);
      } else {
        const { error } = await target.from("boat_routes").insert(payload);
        if (error) throw new Error(`boat_routes: ${error.message}`);
      }
    }

    migrated += 1;
  }

  return { sourceCount: sourceRows.length, migratedCount: migrated, skippedCount: skipped };
}

function driverKey(name, phone) {
  return `${String(name || "").trim().toLowerCase()}|${String(phone || "").trim().toLowerCase()}`;
}

async function migrateDrivers(source, target, state, isDryRun) {
  const cols = ["id", "name", "phone", "license_type", "company", "photo_url", "rating_avg", "total_trips", "is_active", "notes"];
  const sourceRows = await fetchAll(source, "drivers", cols.join(","));
  for (const row of sourceRows) {
    state.sourceDriverKeyById.set(String(row.id), driverKey(row.name, row.phone));
  }

  const targetRows = await fetchAll(target, "drivers", "id,name,phone");
  const existingByKey = new Map(targetRows.map((row) => [driverKey(row.name, row.phone), row.id]));

  let migrated = 0;

  for (const row of sourceRows) {
    const key = driverKey(row.name, row.phone);
    const existingId = existingByKey.get(key);
    const payload = sanitize(row, cols.filter((c) => c !== "id"));

    if (!isDryRun) {
      if (existingId) {
        const { error } = await target.from("drivers").update(payload).eq("id", existingId);
        if (error) throw new Error(`drivers: ${error.message}`);
      } else {
        const { data, error } = await target.from("drivers").insert(payload).select("id").single();
        if (error) throw new Error(`drivers: ${error.message}`);
        existingByKey.set(key, data.id);
      }
    }
    migrated += 1;
  }

  const refreshedRows = await fetchAll(target, "drivers", "id,name,phone");
  for (const row of refreshedRows) {
    state.targetDriverIdByKey.set(driverKey(row.name, row.phone), row.id);
  }

  return { sourceCount: sourceRows.length, migratedCount: migrated, skippedCount: 0 };
}

async function migrateVehicles(source, target, state, isDryRun) {
  const cols = ["plate_number", "vehicle_type", "capacity", "color", "default_driver_id", "is_active", "notes"];
  const sourceRows = await fetchAll(source, "vehicles", `id,${cols.join(",")}`);

  const payload = [];
  for (const row of sourceRows) {
    let targetDriverId = null;
    if (row.default_driver_id) {
      const sourceKey = state.sourceDriverKeyById.get(String(row.default_driver_id));
      targetDriverId = sourceKey ? state.targetDriverIdByKey.get(sourceKey) || null : null;
    }

    payload.push({
      plate_number: row.plate_number,
      vehicle_type: row.vehicle_type,
      capacity: row.capacity,
      color: row.color,
      default_driver_id: targetDriverId,
      is_active: row.is_active,
      notes: row.notes,
    });
  }

  await upsertRows(target, "vehicles", payload, "plate_number", isDryRun);
  return { sourceCount: sourceRows.length, migratedCount: payload.length, skippedCount: 0 };
}
