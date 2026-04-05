"use client";

type CompressImageOptions = {
  maxBytes: number;
  maxDimension?: number;
  outputType?: "image/webp" | "image/jpeg";
};

const DEFAULT_MAX_DIMENSION = 1280;
const QUALITY_STEPS = [0.82, 0.74, 0.66, 0.58, 0.5, 0.42];
const SCALE_STEPS = [1, 0.9, 0.8, 0.7, 0.6];

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = (error) => {
      URL.revokeObjectURL(objectUrl);
      reject(error);
    };
    img.src = objectUrl;
  });
}

function renderBlob(
  image: HTMLImageElement,
  width: number,
  height: number,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas not supported"));
      return;
    }

    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Blob conversion failed"));
      },
      type,
      quality,
    );
  });
}

export async function compressImageForUpload(
  file: File,
  {
    maxBytes,
    maxDimension = DEFAULT_MAX_DIMENSION,
    outputType = "image/webp",
  }: CompressImageOptions,
): Promise<File> {
  if (file.size > 0 && file.size <= maxBytes && file.type === outputType) {
    return file;
  }

  const image = await loadImage(file);
  const longestEdge = Math.max(image.width, image.height, 1);
  const baseScale = Math.min(1, maxDimension / longestEdge);

  let bestBlob: Blob | null = null;

  for (const scaleStep of SCALE_STEPS) {
    const scale = Math.min(1, baseScale * scaleStep);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    for (const quality of QUALITY_STEPS) {
      const blob = await renderBlob(image, width, height, outputType, quality);
      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
      }
      if (blob.size <= maxBytes) {
        return new File([blob], "photo.webp", { type: outputType });
      }
    }
  }

  if (bestBlob) {
    return new File([bestBlob], "photo.webp", { type: outputType });
  }

  throw new Error("Unable to compress image");
}
