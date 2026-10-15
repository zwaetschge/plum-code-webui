/*
 * Plum Desk – a voice-mode client of Plum on the desk
 * ESP32-S3 N16R8 + 1.54" ST7789 240x240 + MAX98357A speaker + INMP441 mic
 *
 * Runs on its own over Wi-Fi, powered by USB only. It does what the WebUI
 * voice mode does: listen until you are quiet, let Plum transcribe it
 * (Vocarium Whisper), send the text as the next turn of a Plum chat, let Plum
 * speak the answer (Vocarium OmniVoice) and listen again. The chat is a
 * normal Plum chat. A small plum on the display listens, thinks and talks.
 *
 *   Button (BOOT): start a conversation · while listening: end it ·
 *                  while thinking or speaking: interrupt and talk
 *
 * Plum routes (routes/browserBridge.ts), with the device token as bearer:
 *   POST /api/browser-bridge/desk/transcribe  16 kHz WAV        -> {text}
 *   POST /api/browser-bridge/desk/turn        {text, chatId?}   -> {chatId, text, speech[]}
 *   POST /api/browser-bridge/desk/speech      {text}            -> 16 kHz s16le PCM
 *
 * Wi-Fi and Plum credentials live in secrets.h (not in git, see
 * secrets.example.h). Pins and panel quirks: see GUIDE.md of the starter kit.
 */

#include <SPI.h>
#include <ESP_I2S.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <ArduinoJson.h>
#include "freertos/stream_buffer.h"
#include "esp_heap_caps.h"
#include "secrets.h"

#define VERSION "0.3.0"

// ---- pins ----
#define TFT_SCLK 21
#define TFT_MOSI 47
#define TFT_RST  45
#define TFT_DC   40
#define TFT_CS   41
#define TFT_BL   42
#define MIC_WS   4
#define MIC_SCK  5
#define MIC_SD   6
#define AMP_DIN  7
#define AMP_BCLK 15
#define AMP_LRC  16
#define BUTTON   0    // BOOT button, LOW when pressed
#define VOL_UP   39   // expansion board keys, LOW when pressed
#define VOL_DOWN 38

#define W 240
#define H 240
#define Y_OFF 80
#define RATE 16000

// Voice activity, as in the WebUI voice mode: stop 1.3 s after the last
// speech, give up after 10 s without any.
#define SILENCE_END_MS 1300
#define NO_SPEECH_MS   10000
#define MAX_RECORD_S   15
#define CHAT_IDLE_MS   (30UL * 60 * 1000)   // after 30 min a new chat starts

// ---- states shown on the face ----
enum Mood : uint8_t { IDLE = 0, LISTENING = 1, THINKING = 2, SPEAKING = 3, ERROR_ = 4, SLEEP = 5, HAPPY = 6 };
enum Heard { HEARD, NOTHING, CANCELLED };

static uint16_t fb[W * H];
I2SClass spk(I2S_NUM_0);
I2SClass mic(I2S_NUM_1);
static StreamBufferHandle_t playback;

static volatile uint8_t mood = SLEEP;
static volatile bool flushPlayback = false;
static volatile uint8_t volume = 80;
static volatile float speakLevel = 0;   // 0..1, drives the mouth
static volatile float micLevel = 0;     // 0..1, drives the listening ring
static volatile bool pressed = false;   // button event for the conversation task
static volatile bool meterRequested = false;
static volatile bool questionRequested = false;   // console "q": ask a fixed question, no mic
static volatile int32_t slotEnergy[2];   // console "m": print mic levels for 6 s
static uint32_t happyUntil = 0;

// ---------------------------------------------------------------- display

#define SWAP16(c) ((((c) & 0xFF) << 8) | (((c) >> 8) & 0xFF))
static inline uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return SWAP16(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
}

static void tftCmd(uint8_t cmd, const uint8_t *data = nullptr, size_t len = 0) {
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_DC, LOW);
  SPI.transfer(cmd);
  if (len) {
    digitalWrite(TFT_DC, HIGH);
    SPI.transferBytes((uint8_t *)data, nullptr, len);
  }
  digitalWrite(TFT_CS, HIGH);
}

static void tftInit() {
  pinMode(TFT_RST, OUTPUT);
  pinMode(TFT_DC, OUTPUT);
  pinMode(TFT_CS, OUTPUT);
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(TFT_RST, HIGH); delay(20);
  digitalWrite(TFT_RST, LOW);  delay(20);
  digitalWrite(TFT_RST, HIGH); delay(120);
  SPI.begin(TFT_SCLK, -1, TFT_MOSI, TFT_CS);
  SPI.beginTransaction(SPISettings(40000000, MSBFIRST, SPI_MODE0));
  tftCmd(0x01); delay(150);                 // SWRESET
  tftCmd(0x11); delay(120);                 // SLPOUT
  uint8_t colmod = 0x55; tftCmd(0x3A, &colmod, 1);
  uint8_t madctl = 0xC0; tftCmd(0x36, &madctl, 1);
  tftCmd(0x21);                             // INVON (IPS)
  tftCmd(0x13); delay(10);                  // NORON
  tftCmd(0x29); delay(20);                  // DISPON
  digitalWrite(TFT_BL, HIGH);
}

static void tftFlush() {
  uint8_t caset[] = {0, 0, 0, W - 1};
  uint8_t raset[] = {0, Y_OFF, (uint8_t)((Y_OFF + H - 1) >> 8), (uint8_t)((Y_OFF + H - 1) & 0xFF)};
  tftCmd(0x2A, caset, 4);
  tftCmd(0x2B, raset, 4);
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_DC, LOW);
  SPI.transfer(0x2C);
  digitalWrite(TFT_DC, HIGH);
  SPI.writeBytes((uint8_t *)fb, sizeof(fb));
  digitalWrite(TFT_CS, HIGH);
}

// Drawing happens in upright "source" coordinates; the panel sits rotated
// by 90 degrees, so every pixel is placed through this mapping.
static inline void px(int x, int y, uint16_t c) {
  if ((unsigned)x < W && (unsigned)y < H) fb[(H - 1 - x) * W + y] = c;
}

static inline uint16_t blend(uint16_t a, uint16_t b, float t) {
  uint16_t ua = SWAP16(a), ub = SWAP16(b);
  int r = ((ua >> 11) & 31) + (((ub >> 11) & 31) - ((ua >> 11) & 31)) * t;
  int g = ((ua >> 5) & 63) + (((ub >> 5) & 63) - ((ua >> 5) & 63)) * t;
  int bl = (ua & 31) + ((ub & 31) - (ua & 31)) * t;
  return SWAP16((r << 11) | (g << 5) | bl);
}

static void background(uint16_t top, uint16_t bottom) {
  for (int y = 0; y < H; y++) {
    uint16_t c = blend(top, bottom, y / (float)H);
    for (int x = 0; x < W; x++) px(x, y, c);
  }
}

static void ellipse(float cx, float cy, float rx, float ry, uint16_t c) {
  if (rx < 0.5f || ry < 0.5f) return;
  for (int y = (int)(cy - ry); y <= (int)(cy + ry) + 1; y++)
    for (int x = (int)(cx - rx); x <= (int)(cx + rx) + 1; x++) {
      float dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1.0f) px(x, y, c);
    }
}

/** Ellipse rotated by `angle` radians (the leaf). */
static void ellipseRot(float cx, float cy, float rx, float ry, float angle, uint16_t c) {
  float r = max(rx, ry), ca = cosf(angle), sa = sinf(angle);
  for (int y = (int)(cy - r); y <= (int)(cy + r) + 1; y++)
    for (int x = (int)(cx - r); x <= (int)(cx + r) + 1; x++) {
      float u = (x - cx) * ca + (y - cy) * sa, v = -(x - cx) * sa + (y - cy) * ca;
      if ((u / rx) * (u / rx) + (v / ry) * (v / ry) <= 1.0f) px(x, y, c);
    }
}

/** Ring segment between radii r0..r1 and angles a0..a1 (degrees, 0 = right, y down). */
static void arc(float cx, float cy, float r0, float r1, float a0, float a1, uint16_t c) {
  for (int y = (int)(cy - r1); y <= (int)(cy + r1) + 1; y++)
    for (int x = (int)(cx - r1); x <= (int)(cx + r1) + 1; x++) {
      float dx = x - cx, dy = y - cy, d = sqrtf(dx * dx + dy * dy);
      if (d < r0 || d > r1) continue;
      float a = atan2f(dy, dx) * 57.29578f;
      if (a < a0) a += 360;
      if (a >= a0 && a <= a1) px(x, y, c);
    }
}

/** Thick line with round caps. */
static void line(float x0, float y0, float x1, float y1, float w, uint16_t c) {
  float minx = min(x0, x1) - w, maxx = max(x0, x1) + w, miny = min(y0, y1) - w, maxy = max(y0, y1) + w;
  float vx = x1 - x0, vy = y1 - y0, len2 = vx * vx + vy * vy + 1e-6f, r2 = w * w / 4;
  for (int y = (int)miny; y <= (int)maxy; y++)
    for (int x = (int)minx; x <= (int)maxx; x++) {
      float t = ((x - x0) * vx + (y - y0) * vy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      float dx = x - (x0 + t * vx), dy = y - (y0 + t * vy);
      if (dx * dx + dy * dy <= r2) px(x, y, c);
    }
}

// ---------------------------------------------------------------- face

struct Face {
  float eyeOpen = 1, pupilX = 0, pupilY = 0, mouthOpen = 0, smile = 0.6f, bob = 0, ring = 0, tint = 0;
};
static Face face, target;

static inline void ease(float &v, float to, float k) { v += (to - v) * k; }

static void drawFace(uint32_t now) {
  const uint16_t BG_TOP = rgb(18, 16, 27), BG_BOT = rgb(36, 26, 58);
  const uint16_t PLUM = blend(rgb(122, 76, 255), rgb(234, 33, 67), face.tint);
  const uint16_t PLUM_DARK = blend(rgb(84, 46, 196), rgb(150, 20, 40), face.tint);
  const uint16_t SHINE = rgb(176, 150, 255);
  const uint16_t LEAF = rgb(7, 202, 107), STEM = rgb(110, 72, 40);
  const uint16_t WHITE = rgb(250, 250, 255), INK = rgb(24, 18, 40), MOUTH = rgb(46, 18, 60);
  const uint16_t ACCENT = rgb(77, 125, 255);

  background(BG_TOP, BG_BOT);
  float cx = 120, cy = 132 + face.bob;

  // Listening: a ring that swells with the voice.
  if (face.ring > 0.02f) {
    float r = 96 + 10 * face.ring + 4 * sinf(now / 180.0f);
    arc(cx, cy, r, r + 4 + 6 * face.ring, -180, 180, blend(BG_BOT, ACCENT, 0.4f + 0.6f * face.ring));
  }

  // Body: the plum, a little wider than tall, with a soft shading and a shine.
  ellipse(cx, cy + 3, 90, 84, PLUM_DARK);
  ellipse(cx - 2, cy, 87, 81, PLUM);
  ellipseRot(cx - 46, cy - 42, 16, 8, -0.7f, SHINE);
  // Stem and leaf, the leaf swaying slightly.
  line(cx + 2, cy - 78, cx + 8, cy - 98, 6, STEM);
  ellipseRot(cx + 30, cy - 96, 24, 10, -0.35f + 0.08f * sinf(now / 900.0f), LEAF);

  // Eyes.
  float ey = cy - 18, eh = 21 * face.eyeOpen;
  for (int side = -1; side <= 1; side += 2) {
    float ex = cx + side * 32;
    if (mood == HAPPY && face.eyeOpen > 0.5f) {
      arc(ex, ey + 6, 11, 17, 200, 340, INK);           // happy ^ ^
    } else if (mood == ERROR_) {
      line(ex - 9, ey - 9, ex + 9, ey + 9, 6, INK);       // x x
      line(ex - 9, ey + 9, ex + 9, ey - 9, 6, INK);
    } else if (eh < 3) {
      line(ex - 12, ey, ex + 12, ey, 5, INK);            // closed
    } else {
      ellipse(ex, ey, 16, eh, WHITE);
      ellipse(ex + face.pupilX * 6, ey + face.pupilY * 6 * face.eyeOpen, 8, min(9.0f, eh * 0.55f), INK);
      ellipse(ex + face.pupilX * 6 + 3, ey + face.pupilY * 6 - 3, 2.5f, 2.5f, WHITE);
    }
  }

  // Mouth: an open ellipse while speaking, otherwise a smile (or frown).
  float my = cy + 30;
  if (face.mouthOpen > 0.06f) {
    ellipse(cx, my, 16 + 6 * face.mouthOpen, 4 + 16 * face.mouthOpen, MOUTH);
    ellipse(cx, my + 6 * face.mouthOpen, 9, 5 * face.mouthOpen, rgb(234, 90, 120));
  } else if (face.smile >= 0) {
    arc(cx, my - 18, 22, 28, 90 - 60 * face.smile - 10, 90 + 60 * face.smile + 10, MOUTH);
  } else {
    arc(cx, my + 20, 18, 24, 270 + 50 * face.smile, 270 - 50 * face.smile, MOUTH);
  }

  // Thinking: three dots circling above the head.
  if (mood == THINKING) {
    for (int i = 0; i < 3; i++) {
      float a = now / 260.0f + i * 2.094f;
      float s = 4 + 2 * sinf(now / 200.0f + i);
      ellipse(cx + 34 * cosf(a), 26 + 8 * sinf(a), s, s, ACCENT);
    }
  }
  // Sleeping (no host): z z z drifting up.
  if (mood == SLEEP) {
    for (int i = 0; i < 2; i++) {
      float t = fmodf(now / 2400.0f + i * 0.5f, 1.0f), x = 168 + 30 * t, y = 70 - 40 * t, s = 7 + 5 * t;
      uint16_t c = blend(BG_TOP, SHINE, 1 - t);
      line(x - s, y - s, x + s, y - s, 3, c);
      line(x + s, y - s, x - s, y + s, 3, c);
      line(x - s, y + s, x + s, y + s, 3, c);
    }
  }
  // Error: a small red badge.
  if (mood == ERROR_) {
    ellipse(196, 44, 15, 15, rgb(234, 33, 67));
    line(196, 36, 196, 46, 4, WHITE);
    ellipse(196, 52, 2.5f, 2.5f, WHITE);
  }
}

/** Where the face wants to be for the current mood; drawFace eases towards it. */
static void aim(uint32_t now) {
  uint8_t m = mood;
  static uint32_t nextBlink = 3000, blinkUntil = 0, nextGlance = 0;
  static float glanceX = 0, glanceY = 0;
  if (now > nextBlink) { blinkUntil = now + 130; nextBlink = now + 2500 + esp_random() % 3500; }
  if (now > nextGlance) {
    glanceX = ((int)(esp_random() % 3) - 1) * 0.6f;
    glanceY = ((int)(esp_random() % 3) - 1) * 0.3f;
    nextGlance = now + 1800 + esp_random() % 2500;
  }
  bool blink = now < blinkUntil;
  target = Face();
  target.bob = 3 * sinf(now / 700.0f);
  target.pupilX = glanceX;
  target.pupilY = glanceY;
  switch (m) {
    case LISTENING:
      target.eyeOpen = 1.15f; target.pupilX = 0; target.pupilY = 0; target.smile = 0.3f;
      target.ring = 0.25f + min(1.0f, micLevel * 1.6f);
      break;
    case THINKING:
      target.pupilX = 0.7f; target.pupilY = -0.8f; target.smile = 0.1f; target.bob = 1.5f * sinf(now / 300.0f);
      break;
    case SPEAKING:
      target.mouthOpen = min(1.0f, speakLevel * 2.2f); target.smile = 0.4f;
      target.bob = 2 * sinf(now / 260.0f);
      break;
    case ERROR_:
      target.smile = -0.7f; target.tint = 0.45f;
      break;
    case SLEEP:
      target.eyeOpen = 0; target.smile = 0.15f; target.bob = 4 * sinf(now / 1600.0f);
      break;
    case HAPPY:
      target.smile = 1; target.bob = 5 * fabsf(sinf(now / 220.0f));
      break;
    default:
      break;
  }
  if (blink && m != SLEEP) target.eyeOpen = 0.05f;
  float k = 0.35f;
  ease(face.eyeOpen, target.eyeOpen, blink ? 0.8f : k);
  ease(face.pupilX, target.pupilX, 0.2f);
  ease(face.pupilY, target.pupilY, 0.2f);
  ease(face.mouthOpen, target.mouthOpen, 0.55f);
  ease(face.smile, target.smile, 0.2f);
  ease(face.bob, target.bob, 0.3f);
  ease(face.ring, target.ring, 0.3f);
  ease(face.tint, target.tint, 0.15f);
}

// ---------------------------------------------------------------- audio

/** Speaker: drains the playback buffer and measures the level for the mouth. */
static void speakerTask(void *) {
  static int16_t buf[256];
  for (;;) {
    if (flushPlayback) {
      xStreamBufferReset(playback);
      flushPlayback = false;
      speakLevel = 0;
    }
    size_t n = xStreamBufferReceive(playback, buf, sizeof(buf), pdMS_TO_TICKS(20));
    if (!n) { speakLevel *= 0.7f; continue; }
    int count = n / 2;
    float gain = volume / 100.0f, peak = 0;
    for (int i = 0; i < count; i++) {
      float v = buf[i] * gain;
      peak = max(peak, fabsf(v));
      buf[i] = (int16_t)v;
    }
    speakLevel = speakLevel * 0.6f + 0.4f * (peak / 32768.0f);
    spk.write((uint8_t *)buf, count * 2);
  }
}

static bool playbackIdle() { return xStreamBufferIsEmpty(playback) && speakLevel < 0.01f; }

static void chime(const float *notes, int count, int ms) {
  static int16_t tone[RATE / 8];
  int n = min((int)(sizeof(tone) / 2), RATE * ms / 1000);
  for (int k = 0; k < count; k++) {
    for (int i = 0; i < n; i++) {
      float env = min(1.0f, i / 200.0f) * (1.0f - (float)i / n);
      tone[i] = (int16_t)(5000 * env * sinf(2 * M_PI * notes[k] * i / RATE));
    }
    xStreamBufferSend(playback, tone, n * 2, portMAX_DELAY);
  }
}
static const float CHIME_READY[] = {659.3f, 987.8f};
static const float CHIME_LISTEN[] = {880.0f};
static const float CHIME_BYE[] = {987.8f, 659.3f};

/** Reads 32 ms of microphone audio as 16-bit mono (the INMP441 sits on one slot). */
static size_t readMic(int16_t *out) {
  static int32_t raw[1024];   // 512 stereo frames
  size_t got = mic.readBytes((char *)raw, sizeof(raw));
  if (got < sizeof(raw)) return 0;
  int64_t e0 = 0, e1 = 0;
  for (int i = 0; i < 512; i++) { e0 += llabs(raw[2 * i] >> 16); e1 += llabs(raw[2 * i + 1] >> 16); }
  int slot = e1 > e0 ? 1 : 0;
  slotEnergy[0] = e0 / 512; slotEnergy[1] = e1 / 512;
  int32_t peak = 0;
  for (int i = 0; i < 512; i++) {
    int32_t v = raw[2 * i + slot] >> 14;      // 16 bit with 4x gain (8x clipped)
    v = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    out[i] = v;
    peak = max(peak, abs(v));
  }
  micLevel = micLevel * 0.5f + 0.5f * (peak / 32768.0f);
  return 512;
}

// ---------------------------------------------------------------- conversation

static uint8_t *recording;            // WAV header + PCM, in PSRAM
static const size_t REC_MAX = 44 + RATE * 2 * MAX_RECORD_S;
static String chatId;
static uint32_t lastTurnMs = 0;

static bool takePress() {
  bool was = pressed;
  pressed = false;
  return was;
}

static void wavHeader(uint8_t *h, uint32_t bytes) {
  uint32_t v;
  memcpy(h, "RIFF", 4); v = 36 + bytes; memcpy(h + 4, &v, 4);
  memcpy(h + 8, "WAVEfmt ", 8); v = 16; memcpy(h + 16, &v, 4);
  uint16_t fmt = 1, ch = 1, align = 2, bits = 16;
  memcpy(h + 20, &fmt, 2); memcpy(h + 22, &ch, 2);
  v = RATE; memcpy(h + 24, &v, 4); v = RATE * 2; memcpy(h + 28, &v, 4);
  memcpy(h + 32, &align, 2); memcpy(h + 34, &bits, 2);
  memcpy(h + 36, "data", 4); memcpy(h + 40, &bytes, 4);
}

// Voice activity on 32 ms blocks: a smoothed level against a noise floor that
// follows the room (falls at once, rises ~13 %/s while nobody speaks), so fans
// and hum are not taken for speech and silence after a sentence is recognised.
struct Vad {
  float level = 0, noise = 0;
  bool speech = false, quiet = true;
  void update(const int16_t *b, size_t n) {
    float sum = 0;
    for (size_t i = 0; i < n; i++) sum += (float)b[i] * b[i];
    float rms = sqrtf(sum / n);
    level = level > 0 ? level * 0.6f + rms * 0.4f : rms;
    if (noise <= 0) noise = level;
    speech = level > max(noise * 4.0f, 450.0f);
    quiet = level < max(noise * 2.2f, 250.0f);
    if (level < noise) noise = noise * 0.7f + level * 0.3f;
    else if (!speech) noise = min(level, noise * 1.004f);
  }
};
static Vad vad;

/** Appends a block; before speech starts only the last `keep` samples are kept (pre-roll). */
static void append(int16_t *pcm, size_t &samples, size_t maxSamples, const int16_t *block, size_t n, bool started, size_t keep) {
  if (!started && samples + n > keep) {
    size_t drop = samples + n - keep;
    drop = min(drop, samples);
    memmove(pcm, pcm + drop, (samples - drop) * 2);
    samples -= drop;
  }
  if (samples + n <= maxSamples) {
    memcpy(pcm + samples, block, n * 2);
    samples += n;
  }
}

/** Records until the speaker is quiet again, like the WebUI voice mode. */
static Heard record(size_t &bytes) {
  mood = LISTENING;
  int16_t *pcm = (int16_t *)(recording + 44);
  size_t samples = 0, maxSamples = RATE * MAX_RECORD_S;
  int loud = 0;
  bool heard = false;
  uint32_t start = millis(), lastVoice = start;
  static int16_t block[512];
  while (true) {
    if (takePress()) { Serial.println("listening cancelled"); return CANCELLED; }
    size_t n = readMic(block);
    if (!n) continue;
    vad.update(block, n);
    uint32_t now = millis();
    loud = vad.speech ? loud + 1 : 0;
    if (loud >= 4) heard = true;   // ~130 ms clearly above the room
    if (!vad.quiet) lastVoice = now;
    append(pcm, samples, maxSamples, block, n, heard, RATE / 2);
    if (heard && now - lastVoice > SILENCE_END_MS) break;
    if (!heard && now - start > NO_SPEECH_MS) {
      Serial.printf("nothing heard (room %.0f)\n", vad.noise);
      return NOTHING;
    }
    if (samples >= maxSamples) break;
  }
  micLevel = 0;
  bytes = samples * 2;
  Serial.printf("recorded %.1f s (room %.0f)\n", samples / (float)RATE, vad.noise);
  return HEARD;
}

static NetworkClientSecure tls;

/** POST to Plum; the body is either JSON or the recorded WAV. */
static bool plumPost(HTTPClient &http, const char *route, const char *type, const uint8_t *body, size_t size, int &status) {
  String url = String(PLUM_URL) + "/api/browser-bridge/desk/" + route;
  if (!http.begin(tls, url)) return false;
  http.setTimeout(180000);
  http.setConnectTimeout(8000);
  http.addHeader("Authorization", String("Bearer ") + PLUM_TOKEN);
  http.addHeader("Content-Type", type);
  status = http.POST((uint8_t *)body, size);
  return status > 0;
}

static String errorText(HTTPClient &http, int status) {
  return status > 0 ? String(status) + " " + http.getString().substring(0, 160) : http.errorToString(status);
}

static bool transcribe(size_t bytes, String &text) {
  wavHeader(recording, bytes);
  HTTPClient http;
  int status = 0;
  bool ok = plumPost(http, "transcribe", "audio/wav", recording, 44 + bytes, status) && status == 200;
  if (ok) {
    JsonDocument doc;
    ok = !deserializeJson(doc, http.getString());
    text = doc["data"]["text"] | "";
    Serial.printf("transcribed %u bytes\n", (unsigned)bytes);
  } else Serial.printf("transcribe failed: %s\n", errorText(http, status).c_str());
  http.end();
  return ok;
}

static bool turn(const String &text, JsonDocument &answer) {
  JsonDocument req;
  req["text"] = text;
  if (chatId.length() && millis() - lastTurnMs < CHAT_IDLE_MS) req["chatId"] = chatId;
  String body;
  serializeJson(req, body);
  HTTPClient http;
  int status = 0;
  bool ok = plumPost(http, "turn", "application/json", (const uint8_t *)body.c_str(), body.length(), status) && status == 200;
  if (ok) {
    ok = !deserializeJson(answer, http.getString());
    chatId = answer["data"]["chatId"] | "";
    lastTurnMs = millis();
    Serial.printf("answer (%u chunks): %.120s\n", answer["data"]["speech"].size(), (const char *)(answer["data"]["text"] | ""));
  } else Serial.printf("turn failed: %s\n", errorText(http, status).c_str());
  http.end();
  return ok;
}

/** Streams one spoken chunk into the speaker; returns false if interrupted or failed. */
static bool speak(const char *text, bool &interrupted) {
  JsonDocument req;
  req["text"] = text;
#ifdef PLUM_VOICE
  req["voice"] = PLUM_VOICE;
#endif
  String body;
  serializeJson(req, body);
  HTTPClient http;
  int status = 0;
  if (!plumPost(http, "speech", "application/json", (const uint8_t *)body.c_str(), body.length(), status) || status != 200) {
    Serial.printf("speech failed: %s\n", errorText(http, status).c_str());
    http.end();
    return false;
  }
  if (mood != SPEAKING) mood = SPEAKING;
  NetworkClient *stream = http.getStreamPtr();
  int left = http.getSize();
  static uint8_t buf[2048];
  uint8_t carry = 0;
  bool odd = false;
  uint32_t lastData = millis();
  while (http.connected() && (left > 0 || left == -1)) {
    if (takePress()) { interrupted = true; break; }
    size_t avail = stream->available();
    if (!avail) {
      if (millis() - lastData > 15000) break;
      vTaskDelay(2);
      continue;
    }
    int n = stream->readBytes(buf + (odd ? 1 : 0), min(avail, sizeof(buf) - 1));
    if (n <= 0) continue;
    lastData = millis();
    if (left > 0) left -= n;
    if (odd) { buf[0] = carry; n += 1; }
    odd = n & 1;
    if (odd) carry = buf[n - 1];
    // Blocks while the buffer is full: the download follows playback.
    xStreamBufferSend(playback, buf, n & ~1, portMAX_DELAY);
  }
  http.end();
  return !interrupted;
}

static void showError(const char *why) {
  Serial.printf("error: %s\n", why);
  mood = ERROR_;
  vTaskDelay(pdMS_TO_TICKS(3000));
}

/**
 * One voice conversation: listen, ask, speak, listen again, until silence or
 * a press. `text` is a question already said together with the wake word.
 */
static void converse(String text) {
  chime(CHIME_LISTEN, 1, 90);
  while (true) {
    if (!text.length()) {
      while (!playbackIdle()) vTaskDelay(pdMS_TO_TICKS(20));
      size_t bytes = 0;
      if (record(bytes) != HEARD) break;   // nothing said for 10 s, or the button: end
      mood = THINKING;
      if (!transcribe(bytes, text)) { showError("Transkription fehlgeschlagen"); break; }
      text.trim();
      Serial.printf("heard: %s\n", text.c_str());
      if (!text.length()) continue;   // only noise: keep listening
    }
    mood = THINKING;
    if (takePress()) { text = ""; continue; }   // pressed while thinking: talk again
    JsonDocument answer;
    bool answered = turn(text, answer);
    text = "";
    if (!answered) { showError("Plum hat nicht geantwortet"); break; }
    if (takePress()) continue;
    bool interrupted = false;
    for (JsonVariant chunk : answer["data"]["speech"].as<JsonArray>()) {
      if (!speak(chunk.as<const char *>(), interrupted)) break;
    }
    if (interrupted) { flushPlayback = true; vTaskDelay(pdMS_TO_TICKS(60)); continue; }
    while (!playbackIdle()) {
      if (takePress()) { flushPlayback = true; break; }
      vTaskDelay(pdMS_TO_TICKS(20));
    }
  }
  micLevel = 0;
  chime(CHIME_BYE, 2, 70);
  mood = IDLE;
}

/**
 * Idle: catches one spoken phrase (with a little audio before it) and lets
 * Plum check it for "Hey Plum". Returns true when woken; `question` holds
 * whatever was said after the wake word. Returns false at once on a press.
 */
static bool listenForWake(String &question) {
  int16_t *pcm = (int16_t *)(recording + 44);
  const size_t PRE = RATE * 3 / 10, MAXS = RATE * 7;
  size_t samples = 0;
  int loud = 0;
  bool started = false;
  uint32_t lastVoice = 0;
  static int16_t block[512];
  while (true) {
    if (pressed || meterRequested || questionRequested || WiFi.status() != WL_CONNECTED) return false;
    size_t n = readMic(block);
    if (!n) continue;
    vad.update(block, n);
    uint32_t now = millis();
    loud = vad.speech ? loud + 1 : 0;
    if (loud >= 3 && !started) started = true;
    if (!vad.quiet) lastVoice = now;
    append(pcm, samples, MAXS, block, n, started, PRE);
    if (started && (now - lastVoice > 700 || samples >= MAXS)) break;
  }
  if (samples < RATE * 6 / 10) return false;   // too short for "Hey Plum"
  wavHeader(recording, samples * 2);
  HTTPClient http;
  int status = 0;
  bool woken = false;
  if (plumPost(http, "wake", "audio/wav", recording, 44 + samples * 2, status) && status == 200) {
    JsonDocument doc;
    if (!deserializeJson(doc, http.getString())) {
      woken = doc["data"]["wake"] | false;
      question = (const char *)(doc["data"]["question"] | "");
      Serial.printf("phrase: %s%s\n", (const char *)(doc["data"]["text"] | ""), woken ? "  -> WAKE" : "");
    }
  } else Serial.printf("wake check failed: %s\n", errorText(http, status).c_str());
  http.end();
  return woken;
}

static void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  mood = SLEEP;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);   // low latency for the audio round trips
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    vTaskDelay(pdMS_TO_TICKS(200));
    if (millis() - start > 30000) {
      showError("WLAN nicht erreichbar");
      WiFi.disconnect();
      WiFi.begin(WIFI_SSID, WIFI_PASS);
      start = millis();
      mood = SLEEP;
    }
  }
  Serial.printf("wifi: %s\n", WiFi.localIP().toString().c_str());
  mood = HAPPY;
  happyUntil = millis() + 1500;
  chime(CHIME_READY, 2, 110);
}

static void conversationTask(void *) {
  tls.useBuiltinCACertBundle();   // Plum's certificate is checked against the public CAs
  for (;;) {
    connectWifi();
    if (meterRequested) {
      meterRequested = false;
      static int16_t block[512];
      for (int i = 0; i < 190; i++) {   // ~6 s
        if (!readMic(block)) continue;
        float sum = 0;
        int32_t peak = 0;
        for (int k = 0; k < 512; k++) { sum += (float)block[k] * block[k]; peak = max(peak, (int32_t)abs(block[k])); }
        if (i % 8 == 0) Serial.printf("mic rms %.0f peak %ld  slot0 %ld slot1 %ld\n", sqrtf(sum / 512), (long)peak, (long)slotEnergy[0], (long)slotEnergy[1]);
      }
    }
    if (questionRequested) {
      questionRequested = false;
      mood = THINKING;
      JsonDocument answer;
      bool interrupted = false;
      if (turn("Sag in einem kurzen Satz Hallo vom Schreibtisch.", answer)) {
        for (JsonVariant chunk : answer["data"]["speech"].as<JsonArray>())
          if (!speak(chunk.as<const char *>(), interrupted)) break;
        while (!playbackIdle()) vTaskDelay(pdMS_TO_TICKS(20));
        Serial.println("question done");
      } else showError("Plum hat nicht geantwortet");
      mood = IDLE;
    }
    if (takePress()) {
      Serial.println("conversation start (button)");
      converse("");
      Serial.println("conversation end");
      continue;
    }
    String question;
    if (listenForWake(question)) {
      Serial.println("conversation start (Hey Plum)");
      converse(question);
      Serial.println("conversation end");
    }
    vTaskDelay(pdMS_TO_TICKS(5));
  }
}

// ---------------------------------------------------------------- setup / loop

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON, INPUT_PULLUP);
  pinMode(VOL_UP, INPUT_PULLUP);
  pinMode(VOL_DOWN, INPUT_PULLUP);
  recording = (uint8_t *)heap_caps_malloc(REC_MAX, MALLOC_CAP_SPIRAM);
  // 20 s of speech in PSRAM, so the next chunk can download while one plays.
  const size_t SIZE = RATE * 2 * 20;
  uint8_t *storage = (uint8_t *)heap_caps_malloc(SIZE + 1, MALLOC_CAP_SPIRAM);
  static StaticStreamBuffer_t meta;
  playback = xStreamBufferCreateStatic(SIZE, 2, storage, &meta);

  tftInit();
  spk.setPins(AMP_BCLK, AMP_LRC, AMP_DIN, -1, -1);
  spk.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_16BIT, I2S_SLOT_MODE_MONO);
  mic.setPins(MIC_SCK, MIC_WS, -1, MIC_SD, -1);
  mic.begin(I2S_MODE_STD, RATE, I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_STEREO);

  xTaskCreatePinnedToCore(speakerTask, "spk", 4096, nullptr, 6, nullptr, 0);
  xTaskCreatePinnedToCore(conversationTask, "talk", 16384, nullptr, 3, nullptr, 0);
  Serial.println("Plum Desk " VERSION);
}

void loop() {
  static uint32_t lastFrame = 0, lastChange = 0;
  static bool wasDown = false;
  uint32_t now = millis();

  // USB console: "t" acts like the button, "s" prints the state.
  while (Serial.available()) {
    int c = Serial.read();
    if (c == 't') { pressed = true; if (mood == SPEAKING) flushPlayback = true; Serial.println("press (console)"); }
    if (c == 'm') meterRequested = true;
    if (c == 'q') questionRequested = true;
    if (c == 's')
      Serial.printf("Plum Desk %s mood=%d wifi=%s rssi=%d ip=%s heap=%u psram=%u mic=%.3f\n", VERSION, mood,
                    WiFi.status() == WL_CONNECTED ? "ok" : "down", WiFi.RSSI(), WiFi.localIP().toString().c_str(),
                    (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getFreePsram(), micLevel);
  }
  bool down = digitalRead(BUTTON) == LOW;
  if (down != wasDown && now - lastChange > 30) {
    wasDown = down;
    lastChange = now;
    if (down) {
      pressed = true;
      Serial.println("press (button)");
      // A press while speaking stops the voice right away.
      if (mood == SPEAKING) flushPlayback = true;
    }
  }
  // Volume keys on the expansion board: ±10 % per press, with a short beep.
  static bool upWas = false, downWas = false;
  static uint32_t keyChange = 0;
  bool up = digitalRead(VOL_UP) == LOW, dn = digitalRead(VOL_DOWN) == LOW;
  if ((up != upWas || dn != downWas) && now - keyChange > 40) {
    keyChange = now;
    if (up && !upWas) volume = min(100, volume + 10);
    if (dn && !downWas) volume = max(10, volume - 10);
    if ((up && !upWas) || (dn && !downWas)) {
      static int16_t beep[RATE / 16];
      for (int i = 0; i < RATE / 16; i++)
        beep[i] = (int16_t)(5000 * (1.0f - (float)i / (RATE / 16)) * sinf(2 * M_PI * 1046.5f * i / RATE));
      xStreamBufferSend(playback, beep, sizeof(beep), 0);
      Serial.printf("volume %d\n", volume);
    }
    upWas = up;
    downWas = dn;
  }
  if (mood == HAPPY && happyUntil && now > happyUntil) { mood = IDLE; happyUntil = 0; }

  if (now - lastFrame >= 33) {
    lastFrame = now;
    aim(now);
    drawFace(now);
    tftFlush();
  }
  vTaskDelay(1);
}
