import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Storage } from "@/lib/storage/types";

type ObjectClient = {
  send(command: unknown): Promise<{ Body?: { transformToByteArray?: () => Promise<Uint8Array> } }>;
};

export class R2Storage implements Storage {
  constructor(
    private readonly client: ObjectClient,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const transform = out.Body?.transformToByteArray;
    if (!transform) throw new Error(`Empty R2 object: ${key}`);
    return Buffer.from(await transform());
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function createR2StorageFromEnv(): R2Storage {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return new R2Storage(client, requireEnv("R2_BUCKET_NAME"));
}
