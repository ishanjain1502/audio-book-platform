import fs from "fs";
import path from "path";
import { jobDir } from "@/lib/jobs/statusFile";

export type JobLogger = {
  info: (message: string) => void;
  error: (message: string) => void;
};

export function createJobLogger(jobId: number): JobLogger {
  const dir = jobDir(jobId);
  fs.mkdirSync(dir, { recursive: true });
  const logPath = path.join(dir, "progress.log");

  const write = (level: string, message: string) => {
    const line = `[${new Date().toISOString()}] [job ${jobId}] [${level}] ${message}`;
    if (level === "ERROR") {
      console.error(line);
    } else {
      console.info(line);
    }
    fs.appendFileSync(logPath, line + "\n");
  };

  return {
    info: (message) => write("INFO", message),
    error: (message) => write("ERROR", message),
  };
}
