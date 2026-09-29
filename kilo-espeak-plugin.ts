import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Any script/command to run on notable events, set via ENV. Args: <event> [title], where event is
// "idle", "permission" or "question"; env KILO_PERMISSION holds the permission name.
const NOTIFY_SCRIPT = process.env.KILO_NOTIFY_SCRIPT;
const MAX_TITLE_LENGTH = 80;

// Serialize runs so notifications from several sessions do not overlap.
let queue: Promise<unknown> = Promise.resolve();

const notify = (kind: string, title: string, env: Record<string, string>) => {
  if (!NOTIFY_SCRIPT) return;
  queue = queue
    .then(() =>
      execFileAsync(NOTIFY_SCRIPT, title ? [kind, title] : [kind], {
        env: { ...process.env, ...env },
      }),
    )
    .catch((error) => console.error("Notification script failed:", error));
};

const EVENTS: Record<string, string> = {
  "session.idle": "idle",
  "permission.asked": "permission",
  "question.asked": "question",
};

export default {
  id: "espeak-notification",
  server: async ({ client }: { client: any }) => ({
    event: async ({ event }: { event: any }) => {
      const kind = EVENTS[event.type];
      if (!kind) return;

      try {
        const sessionID = event.properties?.sessionID;
        let title = "";

        if (sessionID) {
          const result = await client.session.get({ sessionID });
          const session = result?.data ?? result;
          // sub-agent idle is noise; a sub-agent permission request still blocks the work
          if (kind === "idle" && session?.parentID) return;
          title = typeof session?.title === "string" ? session.title.trim() : "";
        }

        if (title.length > MAX_TITLE_LENGTH) {
          title = `${title.slice(0, MAX_TITLE_LENGTH)}…`;
        }

        notify(kind, title, {
          KILO_PERMISSION: String(event.properties?.permission ?? ""),
        });
      } catch (error) {
        console.error("Notification failed:", error);
      }
    },
  }),
};
