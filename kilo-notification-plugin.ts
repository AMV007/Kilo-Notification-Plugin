import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Any script/command to run on notable events, set via ENV. Args: <event> [title], where event is
// "idle", "permission" or "question"; env KILO_PERMISSION holds the permission name.
const NOTIFY_SCRIPT = process.env.KILO_NOTIFY_SCRIPT;
const MAX_TITLE_LENGTH = 80;

// Auto-approve (of the VS Code extension, "always" rules, ...) answers a permission request right
// after the server emits it, so wait this long for a reply before announcing the request. This works
// wherever the server runs (e.g. in a dev container, where the VS Code user settings are not visible).
const PERMISSION_REPLY_GRACE_MS = Number(process.env.KILO_PERMISSION_GRACE_MS ?? 1500);

// Serialize runs so notifications from several sessions do not overlap.
let queue: Promise<unknown> = Promise.resolve();

// IDs of permission requests already answered, consumed by the pending announcements
const repliedPermissions = new Set<string>();

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

const handle = async (client: any, kind: string, event: any) => {
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

    if (kind === "permission") {
      const requestID = event.properties?.id;
      await sleep(PERMISSION_REPLY_GRACE_MS);
      if (typeof requestID === "string" && repliedPermissions.delete(requestID)) return;
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
};

export default {
  id: "notification",
  server: async ({ client }: { client: any }) => ({
    event: async ({ event }: { event: any }) => {
      if (event.type === "permission.replied") {
        // v2 events carry requestID, v1 permissionID
        const requestID = event.properties?.requestID ?? event.properties?.permissionID;
        if (typeof requestID === "string") {
          repliedPermissions.add(requestID);
          // the pending announcement consumes it; drop it anyway if nobody does
          setTimeout(() => repliedPermissions.delete(requestID), PERMISSION_REPLY_GRACE_MS * 4).unref();
        }
        return;
      }

      const kind = EVENTS[event.type];
      if (!kind) return;

      // not awaited: waiting for a permission reply must not hold up delivery of later events
      void handle(client, kind, event);
    },
  }),
};
