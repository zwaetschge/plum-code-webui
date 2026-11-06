/**
 * Die einzige Schicht, die Matrix kennt (§14.1, N7): Client-API mit dem
 * Appservice-Token, ohne SDK. Alles, was der Hub nach draussen schickt, läuft
 * hier durch — und nur hier steht, wie eine Transaktions-ID an der URL hängt.
 */
import { env } from '../env.js';

export type SendOk = { ok: true; eventId: string };
export type SendErr = {
  ok: false;
  status: number;
  errcode: string;
  message: string;
  /** 429/5xx/Netzfehler: später erneut versuchen. */
  retryable: boolean;
  retryAfterMs?: number;
};
export type SendResult = SendOk | SendErr;

export interface AsUser {
  /** Puppet, in dessen Namen der Hub schreibt. Fehlt er, spricht `@schwarm`. */
  user?: string;
  txnId: string;
}

function netzfehler(err: unknown): SendErr {
  return {
    ok: false,
    status: 0,
    errcode: 'M_NETWORK',
    message: err instanceof Error ? err.message : String(err),
    retryable: true,
  };
}

/**
 * Kanonisches JSON (Raumversion 12, `strict_canonicaljson`): Synapse lehnt Kommazahlen
 * in Ereignissen mit M_BAD_JSON ab — so fiel die Agent Card mit `usd_per_minute: 0.025`
 * in den Dead Letter. Kommazahlen gehen deshalb als Text hinaus, ganze Zahlen bleiben.
 */
export function kanonisch(wert: unknown): unknown {
  if (typeof wert === 'number') return Number.isSafeInteger(wert) ? wert : String(wert);
  if (Array.isArray(wert)) return wert.map(kanonisch);
  if (wert && typeof wert === 'object') {
    return Object.fromEntries(
      Object.entries(wert as Record<string, unknown>).map(([k, v]) => [k, kanonisch(v)])
    );
  }
  return wert;
}

export interface CreateRoomAntwort {
  roomId: string | null;
  status: number;
  errcode: string | null;
  message: string | null;
}

export class MatrixClient {
  constructor(
    private readonly baseUrl = env.homeserverUrl,
    private readonly token = env.asToken
  ) {}

  private async request(
    method: string,
    path: string,
    body?: unknown,
    asUser?: string
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const url = new URL(path, this.baseUrl);
    if (asUser) url.searchParams.set('user_id', asUser);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw Object.assign(new Error((err as Error).message), { network: true });
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  }

  private einordnen(res: { status: number; json: Record<string, unknown> }): SendErr {
    const status = res.status;
    const errcode = String(res.json.errcode ?? 'M_UNKNOWN');
    const message = String(res.json.error ?? '');
    const retryable = status === 429 || status >= 500 || status === 0;
    const retryAfter = res.json.retry_after_ms;
    return {
      ok: false,
      status,
      errcode,
      message,
      retryable,
      ...(typeof retryAfter === 'number' ? { retryAfterMs: retryAfter } : {}),
    };
  }

  /** `PUT …/send/{type}/{txnId}` — idempotent über die Transaktions-ID (§10.2). */
  async send(
    roomId: string,
    type: string,
    content: Record<string, unknown>,
    as: AsUser
  ): Promise<SendResult> {
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(type)}/${encodeURIComponent(as.txnId)}`;
    try {
      const res = await this.request('PUT', path, kanonisch(content), as.user);
      if (res.status === 200 && typeof res.json.event_id === 'string') {
        return { ok: true, eventId: res.json.event_id };
      }
      return this.einordnen(res);
    } catch (err) {
      return netzfehler(err);
    }
  }

  async sendState(
    roomId: string,
    type: string,
    stateKey: string,
    content: Record<string, unknown>,
    as: AsUser
  ): Promise<SendResult> {
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/${encodeURIComponent(stateKey)}`;
    try {
      const res = await this.request('PUT', path, kanonisch(content), as.user);
      if (res.status === 200 && typeof res.json.event_id === 'string') {
        return { ok: true, eventId: res.json.event_id };
      }
      return this.einordnen(res);
    } catch (err) {
      return netzfehler(err);
    }
  }

  async redact(roomId: string, eventId: string, reason: string, as: AsUser): Promise<SendResult> {
    const path = `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(as.txnId)}`;
    try {
      const res = await this.request('PUT', path, { reason }, as.user);
      if (res.status === 200 && typeof res.json.event_id === 'string') {
        return { ok: true, eventId: res.json.event_id };
      }
      return this.einordnen(res);
    } catch (err) {
      return netzfehler(err);
    }
  }

  async joinRoom(roomId: string, asUser?: string): Promise<boolean> {
    try {
      const res = await this.request(
        'POST',
        `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`,
        {},
        asUser
      );
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async invite(roomId: string, userId: string): Promise<boolean> {
    try {
      const res = await this.request(
        'POST',
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`,
        { user_id: userId }
      );
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async resolveAlias(alias: string): Promise<string | null> {
    try {
      const res = await this.request(
        'GET',
        `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`
      );
      return res.status === 200 && typeof res.json.room_id === 'string' ? res.json.room_id : null;
    } catch {
      return null;
    }
  }

  /**
   * Raum anlegen. Liefert den Grund mit, wenn es nicht klappt — „Raum konnte nicht
   * angelegt werden" ohne `errcode` half bei `M_EXCLUSIVE` (Alias ausserhalb des
   * Namensraums des Appservice) nicht weiter (ADR-002 §4.31).
   */
  async createRoom(spec: Record<string, unknown>): Promise<CreateRoomAntwort> {
    try {
      const res = await this.request('POST', '/_matrix/client/v3/createRoom', spec);
      if (res.status === 200 && typeof res.json.room_id === 'string') {
        return { roomId: res.json.room_id as string, status: 200, errcode: null, message: null };
      }
      return {
        roomId: null,
        status: res.status,
        errcode: typeof res.json?.errcode === 'string' ? (res.json.errcode as string) : null,
        message: typeof res.json?.error === 'string' ? (res.json.error as string) : null,
      };
    } catch (err) {
      return { roomId: null, status: 0, errcode: null, message: (err as Error).message };
    }
  }

  async members(roomId: string): Promise<string[]> {
    try {
      const res = await this.request(
        'GET',
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`
      );
      if (res.status !== 200) return [];
      return Object.keys((res.json.joined as Record<string, unknown>) ?? {});
    } catch {
      return [];
    }
  }

  /**
   * Datei in den Medien-Speicher von Synapse laden (§10.7). Liefert die
   * `mxc://`-URI, die in ein `m.file`/`m.image`-Event gehört. Puppets laden als
   * sie selbst, damit die Datei zum Absender der Nachricht passt.
   */
  async uploadMedia(
    filename: string,
    mime: string,
    daten: Uint8Array,
    asUser?: string
  ): Promise<{ ok: true; mxc: string } | { ok: false; message: string }> {
    const url = new URL('/_matrix/media/v3/upload', this.baseUrl);
    url.searchParams.set('filename', filename);
    if (asUser) url.searchParams.set('user_id', asUser);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': mime },
        body: daten,
        signal: AbortSignal.timeout(60_000),
      });
      const body = (await res.json().catch(() => ({}))) as { content_uri?: string; error?: string };
      if (res.status === 200 && body.content_uri) return { ok: true, mxc: body.content_uri };
      return { ok: false, message: `${res.status} ${body.error ?? ''}`.trim() };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  /**
   * Verlauf eines Raums, rückwärts blätternd, bis die Grenze erreicht ist
   * (§10.4 nächtlicher Abgleich). Liefert höchstens `maxEvents` Events.
   */
  private async seit(
    roomId: string,
    cutoffMs: number,
    maxEvents = 2000
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let from = '';
    for (let seite = 0; seite < 20; seite++) {
      const qs = new URLSearchParams({ dir: 'b', limit: '200' });
      if (from) qs.set('from', from);
      let res: { status: number; json: Record<string, unknown> };
      try {
        res = await this.request(
          'GET',
          `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${qs.toString()}`
        );
      } catch {
        break;
      }
      if (res.status !== 200) break;
      const chunk = (res.json.chunk as Record<string, unknown>[]) ?? [];
      let aelter = false;
      for (const e of chunk) {
        const ts = Number(e.origin_server_ts ?? 0);
        if (ts < cutoffMs) {
          aelter = true;
          continue;
        }
        out.push(e);
        if (out.length >= maxEvents) return out;
      }
      const next = res.json.end;
      if (aelter || !next || typeof next !== 'string' || chunk.length === 0) break;
      from = next;
    }
    return out;
  }

  /** Öffentlicher Zugriff auf den Verlauf seit einem Zeitpunkt. */
  async messagesSince(
    roomId: string,
    cutoffMs: number,
    maxEvents = 2000
  ): Promise<Record<string, unknown>[]> {
    return this.seit(roomId, cutoffMs, maxEvents);
  }

  /**
   * Nachrichten eines Threads, älteste zuerst. Braucht der Hub, um aus Brians
   * Antworten das Ergebnis zusammenzustellen (§10.3, §10.7).
   */
  async threadMessages(
    roomId: string,
    rootEventId: string
  ): Promise<{ eventId: string; sender: string; ts: number; body: string; msgtype: string }[]> {
    try {
      const res = await this.request(
        'GET',
        `/_matrix/client/v1/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(rootEventId)}/m.thread/m.room.message?limit=200&dir=f`
      );
      if (res.status !== 200) return [];
      const chunk = (res.json.chunk as Record<string, unknown>[]) ?? [];
      return chunk
        .filter((e) => (e.content as Record<string, unknown> | undefined)?.msgtype)
        .map((e) => {
          const content = (e.content ?? {}) as Record<string, unknown>;
          return {
            eventId: String(e.event_id ?? ''),
            sender: String(e.sender ?? ''),
            ts: Number(e.origin_server_ts ?? 0),
            body: String(content.body ?? ''),
            msgtype: String(content.msgtype ?? ''),
          };
        })
        .sort((a, b) => a.ts - b.ts);
    } catch {
      return [];
    }
  }

  /**
   * Ping in beide Richtungen (§10.1, 7): Der Hub ruft Synapse auf, Synapse ruft
   * den Hub zurück. Liefert die Laufzeit für /health und bringt Synapse dazu,
   * liegengebliebene Transaktionen sofort zu schicken.
   */
  async ping(): Promise<{ ok: boolean; ms: number; message?: string }> {
    const start = Date.now();
    try {
      const res = await this.request(
        'POST',
        `/_matrix/client/v1/appservice/${encodeURIComponent(env.appserviceId)}/ping`,
        { appservice_id: env.appserviceId }
      );
      const ms =
        typeof res.json.duration_ms === 'number' ? res.json.duration_ms : Date.now() - start;
      if (res.status === 200) return { ok: true, ms };
      return { ok: false, ms, message: `${res.status} ${String(res.json.errcode ?? '')}` };
    } catch (err) {
      return { ok: false, ms: Date.now() - start, message: (err as Error).message };
    }
  }
}

export const matrix = new MatrixClient();
