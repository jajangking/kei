# Kei — robot vision + AI voice assistant

Monorepo with two packages:
- **`./`** — Next.js 16 (App Router) web frontend with computer vision, AI chat, voice control
- **`./esp32/`** — PlatformIO (Arduino framework) firmware for an ESP32 motor-driven robot

## Quick start

```bash
npm run dev          # dev server at http://0.0.0.0:3000 (all interfaces)
npm run build        # production build
npm run lint         # ESLint (only linter — no typecheck in scripts)
# NOTE: Local pio run tidak bisa — build hanya via GitHub CI (push ke main).
# Semua perubahan firmware harus di-commit & push, nanti build otomatis di GitHub Actions.
```

## Architecture

### Web app (`app/`)

| Page/Route | Purpose |
|---|---|---|
| `app/page.tsx` | Main dashboard (HP A / Otak) — camera feed, object/face detection, motor control, simulation map, telemetry. Publishes scene data via MQTT |
| `app/remote/page.tsx` | Remote control (HP B) — joystick, simulasi 2D, telemetry, detection list, AI chat, video relay, emergency control. Subscribes to MQTT scene + telemetry |
| `app/aigroq.tsx` | AI chat component with wake word ("kei"), Groq LLM, browser TTS, motor commands |
| `app/voicegroq.tsx` | Voice-first AI component — push-to-talk, streaming Groq, multi-TTS, goal navigation |
| `app/xiaozhi/page.tsx` | Standalone voice chat test page (STT → Groq → TTS pipeline) |
| `app/simulasi.tsx` | 2D robot simulation canvas (position, FOV, scan sectors, telemetry map) |
| `app/facerecog.ts` | Face recognition using MediaPipe landmarks + pairwise distance comparison |
| `app/api/tts/route.ts` | Google Translate TTS proxy (`GET /api/tts?text=...`) |
| `app/api/edgetts/route.ts` | Edge TTS via `node-edge-tts` (`GET /api/edgetts?text=...&voice=...`) |
| `app/api/groq/chat/route.ts` | Groq LLM proxy (streaming SSE, `POST /api/groq/chat`) |
| `app/api/proxy/route.ts` | Generic MJPEG/image proxy (`GET /api/proxy?url=...`) |
| `app/api/frame/route.ts` | Video relay — HP A POST frame JPEG, HP B GET polling (`/api/frame`) |
| `app/api/signal/route.ts` | WebRTC signaling (SDP offer/answer exchange via POST/GET) |
| `app/lib/sceneTypes.ts` | Shared types: `SceneMessage`, `SceneDetection`, `SceneFace` for MQTT scene data |

### Remote Control (2-HP / MQTT Bridge)

HP A (Otak, `/`) publishes scene understanding via MQTT topic `kei/robot/{id}/scene`. HP B (Remote, `/remote`) subscribes and shows:
- Live video relay (frame JPEG via `/api/frame`)
- 2D simulasi map + joystick control
- Full telemetry (battery, rssi, heap, uptime, mode, ip, ssid)
- Detection list with coordinates + face recognition results
- Free sector indicators + path status
- Emergency / restart buttons
- AI Chat (VoiceGroq) — independent Groq + TTS on HP B

Motor commands from HP B go directly to ESP32 via MQTT topic `kei/robot/{id}/cmd`.

Key details:
- **TTS fallback**: gTTS (default) → Edge TTS → browser native. Voice picker in `VoiceGroq` and `xiaozhi`.
- **Groq API key**: stored in `localStorage("kei_groq_key")`. Can also set via server env `GROQ_API_KEY`.
- **Vision models** served from `/public/` WASM path: `efficientdet_lite0.tflite`, `blaze_face_short_range.tflite`, MediaPipe WASM at `/wasm/`.
- **Motor control** supports 3 transports: WebSocket → ESP, MQTT (WSS), or direct HTTP.
- **Wake word** is "kei" / "kay" — triggers conversation mode with 30s timeout.
- Language: Indonesian (`id-ID`) for speech recognition and TTS.

### ESP32 firmware (`esp32/`)

- Arduino framework, board `esp32dev`
- WebSocket server on port 81, HTTP on port 80
- Motor driver pins: PWMA=25, AIN1=26, AIN2=27, PWMB=13, BIN1=14, BIN2=33, STBY=32
- Health endpoint `GET /` returns JSON with `{ name, ip, ... }`
- Motor commands via WebSocket/HTTP/MQTT: `{ leftMotor: N, rightMotor: N }` (range -255..255)
- Telemetry broadcast every 1s over WebSocket

### CI

`.github/workflows/build.yml` — on push to `main`, builds ESP32 firmware with PlatformIO, uploads binaries as artifacts, creates a GitHub release.

## Commands & conventions

- **No test framework configured** — `test/` dir is empty, no test scripts in `package.json`
- **No typecheck script** — `tsc` must be run manually if needed
- **Tailwind v4** — uses `@import "tailwindcss"` syntax (PostCSS via `@tailwindcss/postcss`)
- **ESLint 9 flat config** — `eslint.config.mjs`
- **`@/*` path alias** maps to root (e.g. `import x from "@/app/...`)
- **Config persistence** — all settings (ESP IP, MQTT config, Groq key, face DB) stored in `localStorage`; export/import via JSON file
- **`allowedDevOrigins: ["*"]`** in `next.config.ts` — dev server accepts all hosts

## ESP32 discovery

On the main page, "Cari" button probes subnets `192.168.42.x`, `192.168.1.x`, `192.168.0.x`, `10.0.2.x`, `10.223.x`, `172.20.10.x`, and `kei.local` via mDNS.

## HTML dev workflow

Dashboard HTML (`PAGE_INDEX`) ada di `esp32/data/index.html` — edit aja di situ, jalanin `python scripts/html2h.py` buat sync ke `src/page_index.h`, tinggal rebuild firmware. Bisa juga buka langsung `index.html` di browser pake mock data (tinggal ganti `/telemetry` sama `/cmd` endpoint).
