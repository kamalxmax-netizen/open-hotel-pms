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
      try {
        if (event.type !== "message" || event.message?.type !== "text") continue;
        const text = String(event.message.text ?? "").trim();
        const replyToken = event.replyToken ? String(event.replyToken) : "";
        const lineUserId = event.source?.userId ? String(event.source.userId) : "";
        if (!replyToken || !lineUserId) continue;

        const upper = text.toUpperCase();
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

        await replyLineText(replyToken, "ระบบพร้อมใช้งานแล้ว ส่งคำสั่ง: BIND <token>");
      } catch (eventErr) {
        console.error("line webhook event handler error", eventErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("api/webhooks/line POST failed", err);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
