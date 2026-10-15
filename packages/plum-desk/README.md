# Plum Desk

A voice-mode client of Plum on the desk: an ESP32-S3 with a 1.54" display,
speaker and microphone that runs on its own over Wi-Fi and only needs power.

It does what the WebUI voice mode does (VoiceComposer): it listens until you
are quiet, lets Plum transcribe it (Vocarium Whisper), sends the text as the
next turn of a Plum chat, lets Plum speak the answer (Vocarium OmniVoice) and
listens again. The board never talks to Vocarium itself. The conversation is
an ordinary Plum chat ("Plum Desk · …") in the chat list.

```
board ──Wi-Fi/TLS──▶ Plum /mobile/api/browser-bridge/desk/*  ──▶ Vocarium (Whisper, OmniVoice)
                                                              └─▶ model chat (api-chats)
```

## Using it

- **Button (BOOT):** starts a conversation (short chime, the plum listens).
- Speak; 1.3 s of silence ends your turn. The plum thinks, then answers and listens again.
- 10 s without speech, or a press while it listens, ends the conversation.
- A press while it thinks or speaks interrupts it, and you can talk right away.
- After 30 minutes without a turn the next conversation starts a new chat.

The face shows the state: sleeping (no Wi-Fi), listening (ring follows your
voice), thinking (dots circle above), speaking (mouth follows the voice), error
(red badge, details on the USB serial console at 115200 baud).

## Plum side

`packages/backend/src/services/browserBridge/desk.ts`, routes in
`routes/browserBridge.ts`, authenticated with a `plum_ff_` device token as
bearer token (Settings → Browser control lists and revokes it as "Plum Desk"):

| Route | Body | Answer |
|---|---|---|
| `POST /api/browser-bridge/desk/transcribe` | 16 kHz mono WAV | `{text}` |
| `POST /api/browser-bridge/desk/turn` | `{text, chatId?}` | `{chatId, text, speech[]}` (answer cut into spoken chunks, markdown removed) |
| `POST /api/browser-bridge/desk/speech` | `{text}` | raw 16 kHz mono s16le PCM in the personalisation's voice |

They are open on the `/mobile` gateway (no SSO login) only because they check
the device token themselves (`middleware/mobileGateway.ts`).

## Firmware

`firmware/PlumDesk/PlumDesk.ino` (Arduino, ESP32 core 3.3.x, ArduinoJson 7).
Credentials go into `firmware/PlumDesk/secrets.h`, which git ignores; copy
`secrets.example.h`. The board needs a 2.4 GHz network.

Build and flash over USB (on the Geekom, `~/plum-desk/firmware`):

```bash
FQBN="esp32:esp32:esp32s3:USBMode=hwcdc,CDCOnBoot=cdc,FlashMode=qio,FlashSize=16M,PSRAM=opi,PartitionScheme=default"
arduino-cli lib install ArduinoJson
arduino-cli compile --fqbn "$FQBN" PlumDesk
arduino-cli upload  --fqbn "$FQBN" -p /dev/ttyACM0 PlumDesk
```

After flashing, any USB power supply is enough. Pins, panel quirks and the
factory firmware backup are described in the starter kit's `GUIDE.md`
(`AI/plum-code/esp32-smiley`).

USB console (115200 baud) for diagnosis: `t` acts like the button, `s` prints
state, Wi-Fi and memory, `m` prints microphone levels for 6 s, `q` asks a fixed
question without the microphone (tests Wi-Fi, TLS, Plum and the speaker).

Plum's certificate is verified against the public CA bundle built into the
ESP32 core. Recording (up to 30 s) and a 20 s playback buffer live in PSRAM.
