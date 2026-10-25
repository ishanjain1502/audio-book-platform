import fs from "fs";
import path from "path";

export type JobStatusFile = {
  id: number;
  status: string;
  email: string;
  error?: string | null;
  progress: number;
  /** Human-readable step, e.g. "annotate", "synthesize", "character_map" */
  phase?: string;
  /** Current unit of work, e.g. "chapter 0 paragraph 3/13" */
  detail?: string;
  chapters: {
    idx: number;
    title: string;
    ready: boolean;
  }[];
};

function jobsRoot(): string {
  const raw = process.env.DATA_DIR ?? "./src/data";
  const base = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  return path.join(base, "jobs");
}

export function jobDir(jobId: number): string {
  return path.join(jobsRoot(), String(jobId));
}

export function statusPath(jobId: number): string {
  return path.join(jobDir(jobId), "status.json");
}

export function readJobStatus(jobId: number): JobStatusFile | null {
  const file = statusPath(jobId);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as JobStatusFile;
}

export function writeJobStatus(status: JobStatusFile): void {
  const dir = jobDir(status.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statusPath(status.id), JSON.stringify(status, null, 2));
}

export function allocateJobId(): number {
  const root = jobsRoot();
  fs.mkdirSync(root, { recursive: true });
  const counterFile = path.join(root, ".next-id");
  let id = 1;
  if (fs.existsSync(counterFile)) {
    id = Number(fs.readFileSync(counterFile, "utf8")) || 1;
  }
  fs.writeFileSync(counterFile, String(id + 1));
  return id;
}
