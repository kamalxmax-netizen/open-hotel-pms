import { NextRequest, NextResponse } from "next/server";
import {
  chunkArray,
  parseDryRunFlag,
  parseMigrationWorkbook,
  requireAdminRouteAccess,
} from "@/lib/guest-migration";

const INSERT_CHUNK_SIZE = 100;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminRouteAccess(request);
    if (!auth.ok) return auth.response;

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "Missing file. Please upload Excel file as `file`." },
        { status: 400 }
      );
    }
    const dryRun = parseDryRunFlag(formData.get("dry_run"));

    const parsed = await parseMigrationWorkbook(file);

    const result = {
      profiles_inserted: 0,
      profiles_failed: 0,
      stays_inserted: 0,
      stays_failed: 0,
      unmatched_stays: parsed.preview.unmatched_stays,
      unmatched_stay_names: parsed.preview.unmatched_stay_names,
      errors: [] as string[],
    };

    if (dryRun) {
      result.profiles_inserted = parsed.guests.length;
      result.stays_inserted = parsed.stays.length;
      return NextResponse.json({
        success: true,
        dry_run: true,
        result,
      });
    }

    const profileRows = parsed.guests.map((guest) => ({
      id: guest.id,
      first_name: guest.first_name,
      last_name: guest.last_name,
      phone: guest.phone,
      line_id: guest.line_id,
      stay_count: guest.stay_count,
      legacy_night_count: guest.legacy_night_count,
      last_stay_date: guest.last_stay_date,
      preferences: guest.preferences,
      vip_tier: guest.vip_tier,
      profile_status: guest.profile_status,
    }));

    const insertedProfileIds = new Set<string>();
    for (const [index, chunk] of chunkArray(profileRows, INSERT_CHUNK_SIZE).entries()) {
      const { error } = await auth.supabase.from("guest_profiles").insert(chunk);
      if (error) {
        result.profiles_failed += chunk.length;
        result.errors.push(`profiles chunk ${index + 1}: ${error.message}`);
        continue;
      }
      result.profiles_inserted += chunk.length;
      for (const row of chunk) insertedProfileIds.add(String(row.id));
    }

    const stayRows = parsed.stays
      .filter((stay) => insertedProfileIds.has(stay.guest_profile_id))
      .map((stay) => ({
        guest_profile_id: stay.guest_profile_id,
        date_in: stay.date_in,
        date_out: stay.date_out,
        nights: stay.nights,
        room_number: stay.room_number,
        source_file: stay.source_file,
        notes: stay.notes,
      }));

    result.stays_failed += parsed.stays.length - stayRows.length;
    if (parsed.stays.length !== stayRows.length) {
      result.errors.push(
        `Skipped ${parsed.stays.length - stayRows.length} stays because related guest profile insert failed.`
      );
    }

    for (const [index, chunk] of chunkArray(stayRows, INSERT_CHUNK_SIZE).entries()) {
      const { error } = await auth.supabase.from("legacy_stays").insert(chunk);
      if (error) {
        result.stays_failed += chunk.length;
        result.errors.push(`legacy_stays chunk ${index + 1}: ${error.message}`);
        continue;
      }
      result.stays_inserted += chunk.length;
    }

    return NextResponse.json({
      success: true,
      dry_run: false,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Execute failed.";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

