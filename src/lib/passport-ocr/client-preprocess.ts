export const PASSPORT_OCR_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export const PASSPORT_OCR_IMAGE_OPT = {
  FULL_MAX_SIDE: 1800,
  MRZ_MAX_SIDE: 1800,
  JPEG_QUALITY: 0.85,
};

export function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Cannot read image file."));
    reader.readAsDataURL(file);
  });
}

export function optimizeImageDataUrl(dataUrl: string, maxSide: number, quality: number) {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) {
        resolve(dataUrl);
        return;
      }

      const limit = Math.max(600, Number(maxSide) || 1800);
      const longest = Math.max(srcW, srcH);
      const scale = longest > limit ? limit / longest : 1;
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, 0, 0, srcW, srcH, 0, 0, outW, outH);
      resolve(canvas.toDataURL("image/jpeg", quality || 0.85));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function cropBottomMrzDataUrl(dataUrl: string, preset: "tight" | "legacy" = "tight") {
  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.naturalWidth || img.width;
      const srcH = img.naturalHeight || img.height;
      if (!srcW || !srcH) {
        resolve(dataUrl);
        return;
      }

      const crop =
        preset === "legacy"
          ? { left: 0.02, top: 0.46, width: 0.96, bottom: 0.98 }
          : { left: 0.03, top: 0.60, width: 0.94, bottom: 0.985 };

      const left = Math.max(0, Math.floor(srcW * crop.left));
      const top = Math.max(0, Math.floor(srcH * crop.top));
      const width = Math.max(1, Math.min(srcW - left, Math.floor(srcW * crop.width)));
      const bottomPx = Math.max(top + 1, Math.min(srcH, Math.floor(srcH * crop.bottom)));
      const height = Math.max(1, bottomPx - top);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      ctx.drawImage(img, left, top, width, height, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", 0.95));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function dataUrlToBlob(dataUrl: string) {
  const [meta, b64] = String(dataUrl || "").split(",");
  const mime = /data:([^;]+)/.exec(meta || "")?.[1] || "image/jpeg";
  const binary = atob(b64 || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export async function buildPassportMrzDataUrl(file: File): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  const fullDataUrl = await optimizeImageDataUrl(
    rawDataUrl,
    PASSPORT_OCR_IMAGE_OPT.FULL_MAX_SIDE,
    PASSPORT_OCR_IMAGE_OPT.JPEG_QUALITY
  );
  const mrzRawDataUrl = await cropBottomMrzDataUrl(fullDataUrl, "tight");
  const finalMrzDataUrl = await optimizeImageDataUrl(
    mrzRawDataUrl,
    PASSPORT_OCR_IMAGE_OPT.MRZ_MAX_SIDE,
    PASSPORT_OCR_IMAGE_OPT.JPEG_QUALITY
  );
  return finalMrzDataUrl;
}

export async function buildPassportMrzBlob(file: File): Promise<Blob> {
  const dataUrl = await buildPassportMrzDataUrl(file);
  return dataUrlToBlob(dataUrl);
}
