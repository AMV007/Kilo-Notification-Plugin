import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Any script/command to run on notable events, set via ENV. Args: <event> [title], where event is
// "idle", "permission" or "question"; env KILO_PERMISSION holds the permission name.
const NOTIFY_SCRIPT = process.env.KILO_NOTIFY_SCRIPT;
const MAX_TITLE_LENGTH = 80;

// Auto-approve of the Kilo VS Code extension is client-side: the server still emits permission.asked
// and the extension replies to it. The switch lives in the VS Code settings, so read it from there.
const VSCODE_SETTINGS =
  process.env.KILO_VSCODE_SETTINGS ?? join(homedir(), ".config", "Code", "User", "settings.json");
const AUTO_APPROVE_KEY = /^\s*"kilo-code\.new\.autoApprove\.enabled"\s*:\s*(true|false)/m;

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

// true/false if the settings file sets the flag, undefined if it does not (or is missing)
const readAutoApprove = async (file: string) => {
  try {
    const match = (await readFile(file, "utf8")).match(AUTO_APPROVE_KEY);
    return match ? match[1] === "true" : undefined;
  } catch {
    return undefined;
  }
};

// Same precedence as the extension: a workspace value overrides the user one.
const isAutoApproved = async (directory: unknown) =>
  (typeof directory === "string"
    ? await readAutoApprove(join(directory, ".vscode", "settings.json"))
    : undefined) ??
  (await readAutoApprove(VSCODE_SETTINGS)) ??
  false;

const EVENTS: Record<string, string> = {
  "session.idle": "idle",
  "permission.asked": "permission",
  "question.asked": "question",
};

export default {
  id: "notification",
  server: async ({ client }: { client: any }) => ({
    event: async ({ event }: { event: any }) => {
      const kind = EVENTS[event.type];
      if (!kind) return;

      try {
        const sessionID = event.properties?.sessionID;
        let title = "";
        let directory: unknown;

        if (sessionID) {
          const result = await client.session.get({ sessionID });
          const session = result?.data ?? result;
          // sub-agent idle is noise; a sub-agent permission request still blocks the work
          if (kind === "idle" && session?.parentID) return;
          title = typeof session?.title === "string" ? session.title.trim() : "";
          directory = session?.directory;
        }

        // the extension never auto-approves sandbox escalation, so the user still has to answer it
        if (
          kind === "permission" &&
          event.properties?.metadata?.sandboxEscalation !== true &&
          (await isAutoApproved(directory))
        ) {
          return;
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
