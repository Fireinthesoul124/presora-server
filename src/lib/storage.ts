import crypto from 'crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || 'presora';
const PUBLIC_BASE_URL = process.env.R2_PUBLIC_BASE_URL; // e.g. a bucket custom domain or r2.dev URL

export function isStorageConfigured() {
  return Boolean(ACCOUNT_ID && ACCESS_KEY_ID && SECRET_ACCESS_KEY && PUBLIC_BASE_URL);
}

let client: S3Client | null = null;
function getClient() {
  if (!client) {
    client = new S3Client({
      region: 'auto',
      endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: ACCESS_KEY_ID!, secretAccessKey: SECRET_ACCESS_KEY! },
    });
  }
  return client;
}

/** Uploads one file and returns its public URL. Key is namespaced by user so uploads can't collide or be guessed. */
export async function uploadImage(userId: string, buffer: Buffer, contentType: string): Promise<string> {
  if (!isStorageConfigured()) throw new Error('R2 storage is not configured (R2_* env vars missing)');

  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `${userId}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

  await getClient().send(
    new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType })
  );

  return `${PUBLIC_BASE_URL!.replace(/\/$/, '')}/${key}`;
}
