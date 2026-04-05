import {
  createLostFoundSignedUrl,
  getLostFoundAllowedImageTypes,
  getLostFoundBucketName,
  getLostFoundErrorMessage,
  getLostFoundErrorStatus,
  getLostFoundItemById,
  getLostFoundMaxUploadBytes,
  requireLostFoundActor,
} from "@/lib/lost-found";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const runtime = "nodejs";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function normalizeItemId(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createServerSupabaseClient();
    await requireLostFoundActor(supabase, request, ["admin", "frontdesk", "maid", "supervisor"]);

    const formData = await request.formData();
    const itemId = normalizeItemId(formData.get("item_id") ?? formData.get("id"));
    const image = formData.get("image") ?? formData.get("file");

    if (!itemId) {
      return NextResponse.json({ success: false, error: "item_id is required." }, { status: 400 });
    }
    if (!(image instanceof File)) {
      return NextResponse.json({ success: false, error: "image is required." }, { status: 400 });
    }

    const allowedTypes = getLostFoundAllowedImageTypes();
    if (!allowedTypes.has(image.type)) {
      return NextResponse.json(
        { success: false, error: "Unsupported image format. Allowed: jpeg, png, webp." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    if (buffer.length <= 0) {
      return NextResponse.json({ success: false, error: "Uploaded image is empty." }, { status: 400 });
    }
    if (buffer.length > getLostFoundMaxUploadBytes()) {
      return NextResponse.json({ success: false, error: "Image is too large. Maximum file size is 5MB." }, { status: 400 });
    }

    const current = await getLostFoundItemById(supabase, itemId);
    if (current.cleared_at) {
      return NextResponse.json({ success: false, error: "Cleared item cannot receive photo upload." }, { status: 409 });
    }
    if (current.status !== "pending") {
      return NextResponse.json({ success: false, error: "Claimed item cannot receive photo upload." }, { status: 409 });
    }

    const ext = MIME_TO_EXT[image.type] ?? "webp";
    const objectPath = `${itemId}.${ext}`;
    const previousPath = current.photo_path?.trim() || null;

    if (previousPath && previousPath !== objectPath) {
      await supabase.storage.from(getLostFoundBucketName()).remove([previousPath]);
    }

    const { error: uploadError } = await supabase.storage
      .from(getLostFoundBucketName())
      .upload(objectPath, buffer, {
        contentType: image.type,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json({ success: false, error: uploadError.message }, { status: 500 });
    }

    const { data, error } = await supabase
      .from("lost_found_items")
      .update({ photo_path: objectPath })
      .eq("id", itemId)
      .select("id, photo_path")
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      item_id: String(data.id),
      photo_path: String(data.photo_path ?? ""),
      photo_url: await createLostFoundSignedUrl(supabase, String(data.photo_path ?? "")),
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: getLostFoundErrorMessage(error) },
      { status: getLostFoundErrorStatus(error) },
    );
  }
}
