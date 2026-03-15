#!/usr/bin/env npx ts-node
/**
 * Phase C: One-time HK Data Migration Script
 * Import housekeeping_logs from Maintenance App Supabase → PMS room_stay_history
 *
 * Usage:
 *   MAINT_SUPABASE_URL=https://xxx.supabase.co \
 *   MAINT_SUPABASE_KEY=service_role_key \
 *   PMS_SUPABASE_URL=https://yyy.supabase.co \
 *   PMS_SUPABASE_KEY=service_role_key \
 *   npx ts-node scripts/migrate-hk-logs.ts
 */

import { createClient } from "@supabase/supabase-js";

const MAINT_URL = process.env.MAINT_SUPABASE_URL!;
const MAINT_KEY = process.env.MAINT_SUPABASE_KEY!;
const PMS_URL = process.env.PMS_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const PMS_KEY = process.env.PMS_SUPABASE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!MAINT_URL || !MAINT_KEY) {
    console.error("❌ Missing MAINT_SUPABASE_URL or MAINT_SUPABASE_KEY environment variables");
    process.exit(1);
}

const maintClient = createClient(MAINT_URL, MAINT_KEY);
const pmsClient = createClient(PMS_URL, PMS_KEY);

async function run() {
    console.log("🚀 Starting HK logs migration...\n");

    // 1. Fetch all Done logs from Maintenance App
    console.log("📥 Fetching housekeeping_logs (status=Done) from Maintenance App...");
    const { data: hkLogs, error: hkErr } = await maintClient
        .from("housekeeping_logs")
        .select("room, created_at")
        .eq("status", "Done");
    if (hkErr) { console.error("❌ Failed to fetch HK logs:", hkErr.message); process.exit(1); }
    console.log(`   Found ${hkLogs?.length ?? 0} logs\n`);

    // 2. Fetch rooms from PMS to map room_number → room_id
    console.log("📥 Fetching rooms from PMS...");
    const { data: pmsRooms, error: roomErr } = await pmsClient
        .from("rooms")
        .select("id, room_number");
    if (roomErr) { console.error("❌ Failed to fetch PMS rooms:", roomErr.message); process.exit(1); }

    const roomMap: Record<string, string> = {};
    for (const r of pmsRooms ?? []) {
        roomMap[r.room_number] = r.id;
    }
    console.log(`   Loaded ${Object.keys(roomMap).length} room mappings\n`);

    // 3. Build rows for room_stay_history
    const rows: { room_id: string; stayed_at: string; source: string }[] = [];
    const skipped: string[] = [];

    for (const log of hkLogs ?? []) {
        const roomId = roomMap[log.room];
        if (!roomId) {
            if (!skipped.includes(log.room)) skipped.push(log.room);
            continue;
        }
        const date = new Date(log.created_at).toISOString().split("T")[0];
        rows.push({ room_id: roomId, stayed_at: date, source: "maintenance_app" });
    }

    if (skipped.length > 0) {
        console.log(`⚠ Skipped ${skipped.length} room numbers not found in PMS: ${skipped.join(", ")}\n`);
    }

    console.log(`📤 Inserting ${rows.length} rows into room_stay_history...`);
    if (rows.length === 0) {
        console.log("   Nothing to insert. Done.\n");
        return;
    }

    // 4. Upsert in batches of 500
    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const { error } = await pmsClient
            .from("room_stay_history")
            .upsert(batch, { onConflict: "room_id,stayed_at,source" });
        if (error) {
            console.error(`❌ Batch ${Math.floor(i / BATCH) + 1} failed:`, error.message);
        } else {
            inserted += batch.length;
            console.log(`   ✓ Batch ${Math.floor(i / BATCH) + 1}: ${batch.length} rows`);
        }
    }

    console.log(`\n✅ Migration complete! Inserted/updated ${inserted} stay history records.`);

    // 5. Summary per room
    const summary: Record<string, number> = {};
    for (const r of rows) {
        summary[r.room_id] = (summary[r.room_id] || 0) + 1;
    }
    const roomNumberMap = Object.fromEntries(Object.entries(roomMap).map(([num, id]) => [id, num]));
    console.log("\n📊 Nights per room:");
    Object.entries(summary)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 20)
        .forEach(([id, n]) => console.log(`   Room ${roomNumberMap[id] ?? id}: ${n} nights`));
}

run().catch(err => {
    console.error("❌ Unexpected error:", err);
    process.exit(1);
});
