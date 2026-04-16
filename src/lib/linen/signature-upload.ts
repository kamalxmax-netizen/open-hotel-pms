import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LinenSignatureType = "vendor_pickup" | "fo_return";

function requireEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function getR2Client(): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
    forcePathStyle: true,
  });
}

function getBucket(): string {
  return String(process.env.R2_BUCKET_NAME ?? "pms-backups").trim() || "pms-backups";
}

export async function uploadLinenSignature(params: {
  supabase: SupabaseClient;
  batchId: string;
  type: LinenSignatureType;
  buffer: Buffer;
}) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `signatures/linen/${params.batchId}_${params.type}_${timestamp}.png`;

  await getR2Client().send(new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    Body: params.buffer,
    ContentType: "image/png",
  }));

  const column = params.type === "vendor_pickup" ? "vendor_pickup_signature_url" : "fo_return_signature_url";
  const { error } = await params.supabase.from("laundry_batches").update({ [column]: key }).eq("id", params.batchId);
  if (error) throw new Error(error.message);

  return { key };
}

export async function readLinenSignatureObject(key: string) {
  if (!key.startsWith("signatures/linen/")) throw new Error("Invalid signature key.");
  const response = await getR2Client().send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
  const body = await response.Body?.transformToByteArray();
  if (!body) throw new Error("Signature not found.");
  return Buffer.from(body);
}
