import { runAgents, runRetries } from "./automation";
import { backupJob, monitorJob, reportsJob, housekeeping } from "./ops";
import { slaJob } from "./sla";
import { syncAll } from "./gcal";
import { sweep } from "./translate";
import { purgeOld } from "./trash";
import { runDigest, cleanIntake } from "./digest";
import { guarded } from "./errors";
import { deliverNotifications, dueNotices } from "./notify";
import type { JobFn } from "./jobs";

/** What each scheduled job does (lib/jobs.ts says when). */
export const JOBS_FNS: Record<string, JobFn> = {
  retry: (db) => runRetries(db),
  intake: (db) => runAgents(db, { only: "intake", manual: true }),
  sla: (db) => slaJob(db),
  calendar: (db, c) => syncAll(db, Math.max(5000, c.deadline - Date.now() - 2000)),
  notify: (db, c) => deliverNotifications(db, { deadline: c.deadline }),
  due: (db) => dueNotices(db),
  digest: () => runDigest(null, true),
  translate: (db, c) => sweep(db, Math.max(5000, c.deadline - Date.now() - 2000)),
  backup: (db, c) => backupJob(db, { deadline: c.deadline }),
  agents: (db) => runAgents(db),
  monitor: (db) => monitorJob(db),
  trash: async (db) => ({ trash: await purgeOld(db), housekeeping: await housekeeping(db), intake_files: await guarded(db, "trash:intake", () => cleanIntake().then(() => "ok"), "failed") }),
  reports: (db) => reportsJob(db),
};
