# Kept

Kept extracts **commitments with due dates** from a short utterance and files them in Notion. It is not a transcript dump.

**Track 04 · AI Assistants & Work** (Heads Up, Even Realities). The glasses remember what you promised, and file it in Notion before you forget.

Idle shows how many open promises are in Notion and the next one due. One press listens for up to 20 seconds. The glasses ask **SAVE THIS?** with a short title and a due label. Press saves a row. Swipe discards. Swipe from idle opens the open promises; press one, then press again to mark it done.

Dates resolve in Asia/Jakarta. A missing date is shown as `DUE  ----` and can still be saved. Kept does not invent a date.

## Before 23 Nov 2026

Nothing in this repository existed before 23 Nov 2026. `kangmochi/Kept` was created on 24 Nov 2026 for the Heads Up hackathon. The glasses app, the Hono backend, pairing, commitment extraction, Notion read/write, tests, and the simulator script were built during the event.

These tools already existed and are used as-is:

- The official Even Hub ASR template (`even-realities/evenhub-templates/asr`) for microphone wiring and the startup-page shape. Its client-side `VITE_STT_API_KEY` pattern is not used.
- `@evenrealities/even_hub_sdk` 0.0.16, `@evenrealities/evenhub-cli` 0.2.0, and `@evenrealities/evenhub-simulator` 0.9.5.
- The public Notion REST API, pinned here to `Notion-Version: 2026-03-11`.
- Public OpenAI-compatible chat and audio APIs. The defaults point at Mistral and can be pointed at another host with environment variables only.

The Notion database **Keep — promises** was created by the operator before this backend. Kept does not create a database, add properties, or seed rows. Leave that title as it is. The `Source` property is stored as `kept-g2: <transcript>` so older rows stay recognizable.

## What you need

- Node.js 20 or newer (22 is fine)
- A Notion internal integration that can already edit **Keep — promises**
- A Mistral API key, or any other OpenAI-compatible key
- Even Hub CLI and simulator, installed globally:

```bash
npm install -g @evenrealities/evenhub-cli@0.2.0 @evenrealities/evenhub-simulator@0.9.5
```

The database properties must already be:

| Property | Type        |
| -------- | ----------- |
| Name     | Title       |
| Due      | Date        |
| Done     | Checkbox    |
| Source   | Rich text   |

## Run the simulator demo

```bash
cp .env.example .env
```

Fill these in `.env` yourself. Do not commit that file and do not paste the values into chat:

- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `NOTION_DATA_SOURCE_ID`
- `LLM_API_KEY` and `STT_API_KEY` (they may be the same Mistral key)
- `SESSION_SECRET` (any long random string)

Copying `.env.example` turns `ALLOW_DEV_PAIR` on for this machine. The server leaves it off when the variable is missing. Turn it off before any hosted deploy. With it on, a dev build of the glasses app and this loopback request issue a session without the link page:

```bash
curl -s -X POST http://127.0.0.1:8787/pair \
  -H 'content-type: application/json' \
  -d '{"code":"dev"}'
```

Install and start the two processes:

```bash
npm install
npm run server
```

In a second terminal:

```bash
npm run dev
```

In a third terminal:

```bash
npm run demo:sim
```

That opens the simulator on `http://localhost:5173`. Vite is on port 5173. The API is on `http://127.0.0.1:8787`. `app/app.json` whitelists only `http://localhost:8787`.

### Pairing

Glasses have no keyboard. They show `PAIR  123456`. Open [http://localhost:8787/link](http://localhost:8787/link), type the code, and submit. The glasses poll until a session exists, then store it in `localStorage` (and the Even host store, when that call succeeds).

A dev build also tries `POST /pair` with code `dev` on startup, so the simulator usually skips the code.

### Inject mode

The confirm screen has to work with no microphone. In a dev build the phone page has a text field. Submit a sentence and the glasses show the same **SAVE THIS?** state as a successful listen. You can also open the app with a query:

```text
http://localhost:5173/?inject=I'll%20send%20the%20pricing%20by%20Friday
```

If speech-to-text fails or hears nothing, the glasses show `COULDN'T HEAR` and the inject field stays available.

### What the gestures do

| Gesture | Idle | Listening | SAVE THIS? | List / MARK DONE? |
| --- | --- | --- | --- | --- |
| Press | Listen | Stop and send | Save | Select row / mark done |
| Double press | System exit dialog | Back to idle | Discard | Back |
| Swipe | Open the list | Ignored | Discard | Scroll the list, or leave MARK DONE? |

Double-press on the root calls `shutDownPageContainer(1)`, which is the system exit dialog. Long-press is not an exit gesture.

## Tests

```bash
npm test
```

The extractor tests use a fake model. They cover a Friday promise, “tomorrow” and “besok” in Asia/Jakarta, small talk with no invented date, a dateless reminder, and empty text. `npm test` does not call a live model. One optional check is skipped unless you set `LIVE_LLM=1` and `LLM_API_KEY` is in `.env`:

```bash
LIVE_LLM=1 npm test
```

## Simulator automation

With the server, Vite, and simulator already running (`--automation-port 9898`):

```bash
npm run demo:auto
```

The script waits at least 4 seconds, polls the console for `[kept] ready`, saves a 576×288 RGBA screenshot, and checks that some pixels have alpha greater than 0. It then sends one click. Early input is dropped by the simulator, which is why it waits.

To launch the simulator from the script and stop it afterwards:

```bash
npm run demo:auto -- --spawn
```

`DEMO_INJECT="I'll send the pricing by Friday"` also posts `/inject-text` to the backend. Put the same sentence in the simulator URL (`?inject=`) if the click should land on **SAVE THIS?** rather than start the microphone. `EXIT_CHECK=1` sends a double-press after the click and logs the lit-pixel change. There is no simulator shutdown endpoint. `--spawn` kills the process it started.

## Optional pack

Pack only after `npm run build` has written `app/dist`. From `app/`:

```bash
npm run build
evenhub pack app.json dist -o kept.ehpk --sdk-ver 0.0.16
```

Before sharing a bundle, from the repo root:

```bash
npm run build
grep -riE 'secret_|ntn_|sk-|Bearer ' app/dist || true
```

That search should print nothing. Keys stay in the server `.env`.

## Optional real glasses

The phone cannot see the laptop's `localhost`. That path is not required for the simulator video. If you try it later: bind the server with `HOST=0.0.0.0`, put the phone and laptop on the same LAN, add the exact origin (for example `http://192.168.1.20:8787`) to the network whitelist, and run `evenhub qr --url "http://192.168.1.20:5173"` with Vite's host already set. An HTTPS tunnel origin would be added the same way, one full origin at a time. Do not publish any other machine.

## Layout

```text
app/       Vite + TypeScript glasses app
server/    Hono API on port 8787
scripts/   simulator automation
```

`NOTES.md` records where the installed SDK typings differ from older samples.
