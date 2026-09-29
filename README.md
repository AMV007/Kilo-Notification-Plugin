# kilo-espeak-plugin

A [Kilo](https://kilo.ai) server plugin that runs a script of your choice when a session becomes idle asks for a permission or asks a question, so you know the agent has finished or is waiting for you. The script can speak (espeak, RHVoice), show a desktop notification, send a message, etc.

## How it works

The plugin (`kilo-espeak-plugin.ts`) subscribes to Kilo events and reacts to `session.idle` (agent finished) `permission.asked` (agent waits for a permission) and `question.asked` (agent asks you a question):

1. Reads `sessionID` from the event properties.
2. Fetches the session via `client.session.get({ sessionID })` and takes its title.
3. Truncates the title to 80 characters. Idle events of sub-agent sessions are skipped; permission requests and questions are not, since they block the work.
4. Queues a run of the script from `KILO_NOTIFY_SCRIPT`, passing the event name and the title as arguments (see below). It uses `execFile` without a shell, so the title cannot inject commands.

Errors are caught and logged to the console; a failed notification never breaks the session.

## Requirements

- Kilo with plugin support (TypeScript plugins loaded from `~/.config/kilo/plugins/`).
- Node.js-compatible runtime (uses `node:child_process` and `node:util`).
- An executable script or command that takes the session title as its first argument and does the notification itself (choosing the phrase, language and voice).

## Installation

1. Place `kilo-espeak-plugin.ts` in `~/.config/kilo/plugins/`.
2. Register the plugin in the Kilo config (`~/.config/kilo/kilo.jsonc`):

   ```jsonc
   "plugin": [
     "./plugins/kilo-espeak-plugin.ts"
   ]
   ```

3. Set the script via the environment (e.g. in `~/.profile` or `~/.bashrc`):

   ```bash
   export KILO_NOTIFY_SCRIPT=/path/to/your/script
   ```

4. Restart Kilo.

## Configuration

| What | How |
| --- | --- |
| Script to run (full path or command name) | `KILO_NOTIFY_SCRIPT` env var; if unset, the plugin does nothing |
| Max spoken title length | `MAX_TITLE_LENGTH` (80) |

### Script contract

| Input | Value |
| --- | --- |
| `$1` | event: `idle`, `permission` or `question` |
| `$2` | session title (absent if empty) |
| `KILO_PERMISSION` | permission name (e.g. `bash`, `edit`) for `permission`, empty otherwise |

Example wrapper with different phrases per event:

```bash
#!/usr/bin/env bash
case "$1" in
  permission) espeak "Кило просит разрешение${2:+ в $2}" ;;
  question)   espeak "Кило задаёт вопрос${2:+ в $2}" ;;
  *)          espeak "Кило закончил работу${2:+ в $2}, жду распоряжений" ;;
esac
```

Test the script on its own:

```bash
"$KILO_NOTIFY_SCRIPT" question "My session title"
```

## Known limitations

- The `client` and `event` types are `any`.
- Runs are queued, so a slow script delays later notifications.

## License

Not specified.
