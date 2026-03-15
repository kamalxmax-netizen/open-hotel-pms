const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";

function getVisionApiKey() {
  const apiKey = process.env.GOOGLE_VISION_API_KEY || process.env.VISION_API_KEY || "";
  return String(apiKey || "").trim();
}

export async function detectPassportTextFromBuffer(buffer: Buffer) {
  const apiKey = getVisionApiKey();
  if (!apiKey) {
    throw new Error("Missing GOOGLE_VISION_API_KEY or VISION_API_KEY.");
  }

  const response = await fetch(`${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: {
            content: buffer.toString("base64"),
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        },
      ],
    }),
  });

  const rawText = await response.text();
  let payload: any = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error?.message || `Vision API HTTP ${response.status}`);
  }

  const result = payload?.responses?.[0];
  if (!result) {
    throw new Error("Invalid Vision API response.");
  }

  if (result.error?.message) {
    throw new Error(`Vision API error: ${result.error.message}`);
  }

  return String(result.fullTextAnnotation?.text || result.textAnnotations?.[0]?.description || "");
}
