import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { R2_CONFIG } from "../config.js";

let s3ClientInstance = null;

/**
 * Returns true if direct R2 upload credentials are fully configured.
 *
 * @returns {boolean}
 */
export function isR2Configured() {
  return Boolean(
    R2_CONFIG.accountId &&
    R2_CONFIG.accessKeyId &&
    R2_CONFIG.secretAccessKey &&
    R2_CONFIG.bucketName,
  );
}

/**
 * Returns the singleton S3 client for Cloudflare R2.
 *
 * @returns {S3Client}
 */
export function getR2Client() {
  if (!s3ClientInstance) {
    if (!isR2Configured()) {
      throw new Error("Cloudflare R2 is not configured in .env");
    }
    s3ClientInstance = new S3Client({
      region: "auto",
      endpoint: R2_CONFIG.endpoint,
      credentials: {
        accessKeyId: R2_CONFIG.accessKeyId,
        secretAccessKey: R2_CONFIG.secretAccessKey,
      },
    });
  }
  return s3ClientInstance;
}

/**
 * Uploads a processed buffer directly to Cloudflare R2 bucket.
 *
 * @param {Buffer} buffer
 * @param {string} key - e.g. "<hash>.webp"
 * @param {string} [contentType="image/webp"]
 * @param {number} [timeoutMs=20000]
 * @returns {Promise<{ key: string, size: number, publicUrl: string }>}
 */
export async function uploadBufferToR2(
  buffer,
  key,
  contentType = "image/webp",
  timeoutMs = 20000,
) {
  const client = getR2Client();

  const command = new PutObjectCommand({
    Bucket: R2_CONFIG.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ContentLength: buffer.length,
  });

  await client.send(command, {
    abortSignal: AbortSignal.timeout(timeoutMs),
  });

  const publicUrl = `${R2_CONFIG.publicUrl}/${key}`;
  return {
    key,
    size: buffer.length,
    publicUrl,
  };
}

/**
 * Checks if an object already exists in the R2 bucket using HeadObject.
 *
 * @param {string} key
 * @param {number} [timeoutMs=6000]
 * @returns {Promise<boolean>}
 */
export async function existsInR2(key, timeoutMs = 6000) {
  if (!isR2Configured()) return false;
  try {
    const client = getR2Client();
    const command = new HeadObjectCommand({
      Bucket: R2_CONFIG.bucketName,
      Key: key,
    });
    await client.send(command, {
      abortSignal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound") {
      return false;
    }
    return false;
  }
}
