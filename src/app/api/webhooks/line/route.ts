import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type LineEvent = {
  type?: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
};

type LineWebhookBody = {
  events?: LineEvent[];
};

function getLineSecrets() {
  return {
    channelSecret: process.env.LINE_CHANNEL_SECRET ?? "",
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN ?? "",
  };
}

function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const { channelSecret } = getLineSecrets();
  if (!channelSecret || !signature) return false;

  const digest = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const signatureBuffer = Buffer.from(signature, "utf8");
  const digestBuffer = Buffer.from(digest, "utf8");
  if (signatureBuffer.length !== digestBuffer.length) return false;
  return timingSafeEqual(signatureBuffer, digestBuffer);
}

async function replyLineText(replyToken: string, text: string) {
  const { channelAccessToken } = getLineSecrets();
  if (!channelAccessToken) {
    console.error("LINE_CHANNEL_ACCESS_TOKEN missing");
    return;
  }

  try {
    const response = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${channelAccessToken}`,
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("LINE reply API failed", { status: response.status, body });
    }
  } catch (err) {
    console.error("LINE reply API error", err);
  }
}

/** Bangkok UTC+7 date string "YYYY-MM-DD" */
function bangkokToday(): string {
  const now = new Date();
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return bkk.toISOString().slice(0, 10);
}

async function handleCheckoutQuery(replyToken: string) {
  const supabase = createServerSupabaseClient();
  const today = bangkokToday();

  const { data, error } = await supabase
    .from("reservations")
    .select("id, booking_code, status, checkout_date, guest_name")
    .eq("checkout_date", today)
    .in("status", ["active", "checked_out"])
    .order("status", { ascending: true });

  if (error) {
    console.error("line checkout query failed", error);
    await replyLineText(replyToken, `[DEBUG co] ${error.code ?? "?"}: ${error.message ?? String(error)}`);
    return;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    booking_code: string | null;
    status: string | null;
    checkout_date: string | null;
    guest_name: string | null;
  }>;

  const checkedOut = rows.filter((r) => r.status === "checked_out");
  const remaining = rows.filter((r) => r.status !== "checked_out");
  const total = rows.length;

  if (total === 0) {
    await replyLineText(replyToken, `📋 ยอด Check-Out วันนี้ (${today})\n\nไม่มีการ Check-out กำหนดวันนี้`);
    return;
  }

  const lines = [
    `📋 ยอด Check-Out วันนี้ (${today})`,
    ``,
    `✅ Check-out แล้ว: ${checkedOut.length} ห้อง`,
    `⏳ ยังไม่ Check-out: ${remaining.length} ห้อง`,
    `📊 รวม Due Out วันนี้: ${total} ห้อง`,
  ];

  if (remaining.length > 0 && remaining.length <= 10) {
    lines.push(``);
    lines.push(`ห้องที่ยังไม่ออก:`);
    for (const r of remaining) {
      lines.push(`• ${r.booking_code ?? r.id.slice(0, 8)} — ${r.guest_name ?? "ไม่ระบุชื่อ"}`);
    }
  }

  await replyLineText(replyToken, lines.join("\n"));
}

async function handleInHouseQuery(replyToken: string) {
  const supabase = createServerSupabaseClient();
  const today = bangkokToday();

  // Room assignment lives on reservation_nights, not reservations directly.
  // Query today's occupied nights → join rooms for room_number → join reservations to filter status=active.
  const { data, error } = await supabase
    .from("reservation_nights")
    .select("room_id, rooms(room_number), reservations!inner(status)")
    .eq("stay_date", today)
    .is("cancelled_at", null)
    .not("room_id", "is", null)
    .eq("reservations.status", "active");

  if (error) {
    console.error("line inhouse query failed", error.message, error.code);
    await replyLineText(replyToken, `[DEBUG ih] ${error.code ?? "?"}: ${error.message ?? String(error)}`);
    return;
  }

  type InHouseRow = {
    room_id: string | null;
    rooms: { room_number: string | null }[] | { room_number: string | null } | null;
    reservations: { status: string | null }[] | { status: string | null } | null;
  };
  const rows = (data ?? []) as unknown as InHouseRow[];

  if (rows.length === 0) {
    await replyLineText(replyToken, `🏨 In House วันนี้ (${today})\n\nไม่มีแขกพักอยู่ในโรงแรมขณะนี้`);
    return;
  }

  // Sort room numbers naturally (101, 102, 201...)
  const roomNumbers = rows
    .map((r) => {
      const roomsField = r.rooms;
      if (!roomsField) return null;
      if (Array.isArray(roomsField)) return roomsField[0]?.room_number ?? null;
      return roomsField.room_number ?? null;
    })
    .filter((n): n is string => n !== null)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const lines = [
    `🏨 In House (${today})`,
    ``,
    `จำนวน ${roomNumbers.length} ห้อง`,
    ``,
    roomNumbers.join(", "),
  ];

  await replyLineText(replyToken, lines.join("\n"));
}

async function handleBindCommand(params: {
  token: string;
  lineUserId: string;
  replyToken: string;
}) {
  const { token, lineUserId, replyToken } = params;
  const supabase = createServerSupabaseClient();
  const nowIso = new Date().toISOString();

  const { data: tokenRow, error: tokenError } = await supabase
    .from("line_binding_tokens")
    .select("token, staff_id")
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (tokenError) {
    console.error("line bind token lookup failed", tokenError);
    await replyLineText(replyToken, "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง");
    return;
  }
  if (!tokenRow?.staff_id) {
    await replyLineText(replyToken, "Token ไม่ถูกต้องหรือหมดอายุ กรุณาขอใหม่จากระบบ");
    return;
  }

  const { data: duplicateStaff, error: duplicateError } = await supabase
    .from("staff")
    .select("id")
    .eq("line_user_id", lineUserId)
    .neq("id", tokenRow.staff_id)
    .maybeSingle();

  if (duplicateError) {
    console.error("line bind duplicate check failed", duplicateError);
    await replyLineText(replyToken, "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง");
    return;
  }

  if (duplicateStaff?.id) {
    await replyLineText(
      replyToken,
      "LINE account นี้ผูกกับ staff คนอื่นอยู่แล้ว กรุณาติดต่อ Admin"
    );
    return;
  }

  const { data: consumeToken, error: consumeError } = await supabase
    .from("line_binding_tokens")
    .update({ used_at: nowIso })
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", nowIso)
    .select("staff_id")
    .maybeSingle();

  if (consumeError) {
    console.error("line bind consume token failed", consumeError);
    await replyLineText(replyToken, "ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง");
    return;
  }

  if (!consumeToken?.staff_id) {
    await replyLineText(replyToken, "Token ไม่ถูกต้องหรือหมดอายุ กรุณาขอใหม่จากระบบ");
    return;
  }

  const { data: updatedStaff, error: updateStaffError } = await supabase
    .from("staff")
    .update({
      line_user_id: lineUserId,
      line_bound_at: nowIso,
    })
    .eq("id", consumeToken.staff_id)
    .select("display_name")
    .maybeSingle();

  if (updateStaffError) {
    console.error("line bind update staff failed", updateStaffError);
    await replyLineText(replyToken, "ผูก LINE ไม่สำเร็จ กรุณาขอ Token ใหม่แล้วลองอีกครั้ง");
    return;
  }

  const displayName = updatedStaff?.display_name
    ? String(updatedStaff.display_name)
    : "พนักงาน";
  await replyLineText(replyToken, `ผูก LINE สำเร็จ! ยินดีต้อนรับ คุณ ${displayName}`);
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-line-signature");

    if (!verifyLineSignature(rawBody, signature)) {
      return NextResponse.json({ success: false, error: "Invalid signature" }, { status: 401 });
    }

    let body: LineWebhookBody;
    try {
      body = JSON.parse(rawBody) as LineWebhookBody;
    } catch {
      return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    const events = Array.isArray(body.events) ? body.events : [];
    for (const event of events) {
      let replyToken = event.replyToken ? String(event.replyToken) : "";
      try {
        if (event.type !== "message" || event.message?.type !== "text") continue;
        const text = String(event.message.text ?? "").trim();
        const lineUserId = event.source?.userId ? String(event.source.userId) : "";
        if (!replyToken || !lineUserId) continue;

        const upper = text.toUpperCase();
        const norm = text.toLowerCase().replace(/\s+/g, " ").trim();

        // --- BIND command ---
        if (upper.startsWith("BIND")) {
          // Accept both "BIND <token>" and "BIND<token>" to reduce operator mistakes.
          const token = text.slice(4).trim();
          if (!token) {
            await replyLineText(replyToken, "รูปแบบคำสั่งไม่ถูกต้อง ใช้ BIND <token>");
            continue;
          }
          await handleBindCommand({ token, lineUserId, replyToken });
          continue;
        }

        // --- Checkout query ---
        const isCheckoutQuery =
          norm.includes("checkout") ||
          norm.includes("check out") ||
          norm.includes("check-out") ||
          norm.includes("เช็คเอาท์") ||
          norm.includes("เช็กเอาท์") ||
          norm.includes("เช็คเอา") ||
          norm.includes("c/o") ||
          norm.startsWith("co ") ||
          norm === "co";
        if (isCheckoutQuery) {
          await handleCheckoutQuery(replyToken);
          continue;
        }

        // --- In-house query ---
        const isInHouseQuery =
          norm === "inhouse" ||
          norm === "in house" ||
          norm === "ih" ||
          norm.includes("in house") ||
          norm.includes("inhouse") ||
          norm.includes("แขกพักอยู่") ||
          norm.includes("ห้องที่พัก") ||
          norm.includes("ใครพักอยู่");
        if (isInHouseQuery) {
          await handleInHouseQuery(replyToken);
          continue;
        }

        // --- Help ---
        if (norm === "help" || norm === "ช่วยเหลือ" || norm === "คำสั่ง" || norm === "?" || norm === "menu" || norm === "เมนู") {
          await replyLineText(
            replyToken,
            "📖 คำสั่งที่ใช้ได้:\n\n" +
            "• checkout / co / เช็คเอาท์\n  → ยอด Check-out วันนี้\n\n" +
            "• inhouse / ih / in house\n  → ห้องที่มีแขกพักอยู่ตอนนี้\n\n" +
            "• BIND <token>\n  → ผูก LINE กับบัญชี Staff\n\n" +
            "พิมพ์ help เพื่อดูคำสั่งทั้งหมด"
          );
          continue;
        }

        // --- Unknown ---
        await replyLineText(
          replyToken,
          "ไม่เข้าใจคำสั่ง 🤔\nพิมพ์ help เพื่อดูคำสั่งที่ใช้ได้"
        );
      } catch (eventErr) {
        console.error("line webhook event handler error", eventErr);
        const msg = eventErr instanceof Error ? eventErr.message : String(eventErr);
        await replyLineText(replyToken, `[DEBUG exception] ${msg}`).catch(() => undefined);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("api/webhooks/line POST failed", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
