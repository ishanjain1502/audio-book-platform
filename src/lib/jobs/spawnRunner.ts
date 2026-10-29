import { spawn } from "child_process";
import path from "path";
import { getDb } from "@/lib/db/client";
import { readJobStatus, writeJobStatus } from "@/lib/jobs/statusFile";

export function spawnJobRunner(jobId: number, mode?: "annotate" | "synthesize"): void {
  const script = path.join(process.cwd(), "scripts", "run-job.ts");
  const args = ["tsx", script, String(jobId)];
  if (mode !== undefined) {
    args.push(mode);
  }
  const child = spawn("npx", args, {
    cwd: process.cwd(),
    detached: true,
    stdio: "inherit",
    env: process.env,
    shell: true,
  });
  child.unref();
  child.on("error", (err) => {
    console.error(`Failed to spawn job ${jobId}`, err);
    const message = err.message;
    getDb()
      .prepare("UPDATE jobs SET status = 'failed', error = ? WHERE id = ?")
      .run(message, jobId);
    const current = readJobStatus(jobId);
    if (current) writeJobStatus({ ...current, status: "failed", error: message });
  });
}
