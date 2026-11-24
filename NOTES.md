# Notes

SDK symbols were checked against `@evenrealities/even_hub_sdk@0.0.16` (`dist/index.d.ts`) and the package versions installed on the build machine.

- `npm view` on 24 Nov 2026 reported `@evenrealities/even_hub_sdk` **0.0.16**, `@evenrealities/evenhub-simulator` **0.9.5**, and `@evenrealities/evenhub-cli` **0.2.0**. The public Install tools and Simulator pages have previously said 0.0.14 and 0.9.3. Those pages are stale. This repo pins the npm versions above.
- `audioControl(isOpen, source?)` takes an optional `AudioInputSource`. The ASR template calls `audioControl(true)` with no source. Kept passes `AudioInputSource.Glasses`, which matches the typings and the current docs.
- `CreateStartUpPageContainer` has no `currentSelectedItem` field. Some community samples pass one. It is not in the installed typings, so the list page does not set it. Firmware owns the highlighted row.
- The SDK exports a class spelled `ShutDownContaniner`. Kept calls `bridge.shutDownPageContainer(1)` on double-press of the root (idle and pairing) screen. Mode 0 is not used on the root.
- `StartUpPageCreateResult.success` is numeric `0`. A failed startup page throws instead of being ignored.
- Simulator 0.7.3 capped list item text around 63 bytes. List rows are clipped by UTF-8 bytes, not characters, so a row is not dropped. Displayed titles cap at 28 characters.
- Listening stops after about 1.5 seconds of silence once the PCM RMS rises above 0.02. The 20 second cap and press-to-stop stay in place.
- The API allows CORS from `http://localhost:5173`, `http://127.0.0.1:5173`, `evenhub://app`, and `https://evenhub.app`. Other origins get no allow-origin header.
- `/pair/status` returns the session token at most once per second per code. The glasses poll every 1.5 seconds, so a missed response is picked up on the next poll.
- A press on the idle or pairing screen waits 280 ms before it runs. That leaves room for a double-press to open the system exit dialog without also starting the microphone.
- The GitHub repo is `kangmochi/Kept`. The Notion `Source` value is still prefixed `kept-g2:` because that is the data contract for the existing **Keep — promises** database. The backend does not rename the database.
- The automation script talks to simulator `0.9.5` using the documented control plane: `GET /api/ping`, `GET /api/console?since_id=`, `GET /api/screenshot/glasses` (576×288 RGBA, lit test is alpha > 0), and `POST /api/input`. It was written from that contract. Run it once against a local simulator before treating a recording as proof.
