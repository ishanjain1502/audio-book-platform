import { init } from "neatlogs";

let initPromise: Promise<void> | null = null;
let activeWorkflow: string | null = null;

/** Initialize Neatlogs once per process (Next server or job worker). */
export function initNeatlogs(workflowName: string): Promise<void> {
  if (initPromise) {
    if (activeWorkflow !== workflowName) {
      throw new Error(
        `Neatlogs already initialized for workflow "${activeWorkflow}"`,
      );
    }
    return initPromise;
  }
  activeWorkflow = workflowName;
  initPromise = init({
    apiKey: process.env.NEATLOGS_API_KEY,
    endpoint:
      process.env.NEATLOGS_ENDPOINT ?? "https://ingest.neatlogs.com",
    workflowName,
  }).then(() => undefined);
  return initPromise;
}
