export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  getBuffer(key: string): Promise<Buffer>;
}
