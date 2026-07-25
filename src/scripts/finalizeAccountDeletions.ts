// scripts/finalizeAccountDeletions.ts
//
// Sweeps for accounts whose 7-day self-deletion grace period has elapsed
// (scheduledDeletionAt <= now) and were never cancelled, and finalizes them
// via UserModel.finalizeDueAccountDeletions() — the same soft-delete shape
// as an admin-initiated delete.
//
// This does NOT run automatically inside the Express process. Wire it up
// with whichever scheduler fits your deployment, for example:
//
//   1. A plain cron entry (simplest, no new dependency):
//        # run every hour
//        0 * * * *  cd /path/to/backend && node --loader ts-node/esm scripts/finalizeAccountDeletions.ts >> /var/log/finalize-deletions.log 2>&1
//
//   2. Or, inside your server bootstrap (e.g. src/index.ts), a simple
//      in-process interval if you'd rather not manage an external cron:
//        import { finalizeDueAccountDeletions } from "./models/user.model.js";
//        setInterval(() => { finalizeDueAccountDeletions().catch(console.error); }, 60 * 60 * 1000);
//
//   3. Or a managed scheduler (e.g. a Render/Railway/Heroku cron job, a
//      Kubernetes CronJob) invoking this script on the interval of your
//      choice. An hourly cadence is plenty for a 7-day grace period.
//
// Run directly: `node --loader ts-node/esm scripts/finalizeAccountDeletions.ts`
// (adjust to however this project already runs one-off TS scripts.)

import { finalizeDueAccountDeletions } from "../models/user.model.js";
import { prisma } from "../config/prisma.js";

async function main() {
  const count = await finalizeDueAccountDeletions();
  console.log(`[finalizeAccountDeletions] finalized ${count} account(s).`);
}

main()
  .catch((err) => {
    console.error("[finalizeAccountDeletions] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
