/**
 * Finnhub market data: a shared WebSocket for live trades plus a REST quote
 * fallback (last price / previous close) for when markets are closed, the
 * socket is down, or the device is offline.
 *
 * One socket is shared by every screen. Symbols are reference-counted: the
 * first listener subscribes, the last one unsubscribes, and the socket closes
 * after a short idle period. Dropped connections reconnect with exponential
 * backoff and re-subscribe automatically.
 */

import { env } from "../config/env";
import { ApiError } from "./errors";

export interface Trade {
  symbol: string;
  price: number;
  volume: number;
  timestamp: number;
}

export interface Quote {
  current: number;
  change: number | null;
  percentChange: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  previousClose: number | null;
  timestamp: number | null;
}

export type SocketStatus = "idle" | "connecting" | "open" | "reconnecting" | "paused" | "unavailable";

type TradeListener = (trade: Trade) => void;
type StatusListener = (status: SocketStatus) => void;

interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
}

const OPEN = 1;
const FINNHUB_WS_URL = "wss://ws.finnhub.io";
const FINNHUB_REST_URL = "https://finnhub.io/api/v1";

/** SEC share-class tickers use dashes (BRK-B); Finnhub uses dots (BRK.B). */
export function toFinnhubSymbol(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/-/g, ".");
}

export interface FinnhubSocketOptions {
  apiKey: string;
  createSocket?: (url: string) => SocketLike;
  log?: (message: string) => void;
  idleCloseMs?: number;
  maxBackoffMs?: number;
}

export class FinnhubSocket {
  private socket: SocketLike | null = null;
  private readonly listeners = new Map<string, Set<TradeListener>>();
  private readonly statusListeners = new Set<StatusListener>();
  private status: SocketStatus = "idle";
  private paused = false;
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private tradeLogCount = 0;
  private readonly createSocket: (url: string) => SocketLike;
  private readonly log: (message: string) => void;
  private readonly idleCloseMs: number;
  private readonly maxBackoffMs: number;

  constructor(private readonly options: FinnhubSocketOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike);
    this.log = options.log ?? (() => {});
    this.idleCloseMs = options.idleCloseMs ?? 15_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000;
    if (!options.apiKey) this.status = "unavailable";
  }

  getStatus(): SocketStatus {
    return this.status;
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  subscribe(ticker: string, listener: TradeListener): () => void {
    const symbol = toFinnhubSymbol(ticker);
    let set = this.listeners.get(symbol);
    if (!set) {
      set = new Set();
      this.listeners.set(symbol, set);
      this.send({ type: "subscribe", symbol });
    }
    set.add(listener);
    this.clearIdleTimer();
    this.ensureConnected();

    return () => {
      const current = this.listeners.get(symbol);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.listeners.delete(symbol);
        this.send({ type: "unsubscribe", symbol });
        this.log(`[finnhub] unsubscribed ${symbol}`);
        if (this.listeners.size === 0) this.scheduleIdleClose();
      }
    };
  }

  /** Disconnects without forgetting subscriptions (app backgrounded / offline). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.clearReconnectTimer();
    this.clearIdleTimer();
    this.closeSocket("paused");
    if (this.options.apiKey) this.setStatus("paused");
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.attempt = 0;
    if (this.listeners.size > 0) this.ensureConnected();
    else if (this.options.apiKey) this.setStatus("idle");
  }

  private setStatus(status: SocketStatus) {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }

  private ensureConnected() {
    if (!this.options.apiKey) {
      this.setStatus("unavailable");
      return;
    }
    if (this.paused || this.socket || this.reconnectTimer) return;
    this.connect();
  }

  private connect() {
    this.setStatus(this.attempt > 0 ? "reconnecting" : "connecting");
    this.log(`[finnhub] connecting (attempt ${this.attempt + 1})`);
    const socket = this.createSocket(`${FINNHUB_WS_URL}?token=${encodeURIComponent(this.options.apiKey)}`);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.setStatus("open");
      this.log(`[finnhub] connected; subscribing ${[...this.listeners.keys()].join(", ") || "(none)"}`);
      for (const symbol of this.listeners.keys()) this.send({ type: "subscribe", symbol });
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => {
      this.log("[finnhub] socket error");
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.log(`[finnhub] closed (code ${event?.code ?? "?"})`);
      if (!this.paused && this.listeners.size > 0) this.scheduleReconnect();
      else if (!this.paused) this.setStatus("idle");
    };
  }

  private handleMessage(raw: unknown) {
    let message: { type?: string; data?: { s: string; p: number; v: number; t: number }[]; msg?: string };
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.type === "trade" && Array.isArray(message.data)) {
      for (const d of message.data) {
        const listeners = this.listeners.get(d.s);
        if (!listeners || !Number.isFinite(d.p)) continue;
        const trade: Trade = { symbol: d.s, price: d.p, volume: d.v, timestamp: d.t };
        if (this.tradeLogCount++ % 25 === 0) this.log(`[finnhub] trade ${d.s} ${d.p} x${d.v}`);
        listeners.forEach((l) => l(trade));
      }
    } else if (message.type === "error") {
      this.log(`[finnhub] server error: ${message.msg ?? "unknown"}`);
    }
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const base = Math.min(this.maxBackoffMs, 1000 * 2 ** this.attempt);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.attempt++;
    this.setStatus("reconnecting");
    this.log(`[finnhub] reconnecting in ${delay} ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.paused && this.listeners.size > 0) this.connect();
    }, delay);
  }

  private scheduleIdleClose() {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.listeners.size === 0) {
        this.clearReconnectTimer();
        this.closeSocket("idle");
        if (!this.paused) this.setStatus("idle");
      }
    }, this.idleCloseMs);
  }

  private send(message: { type: "subscribe" | "unsubscribe"; symbol: string }) {
    if (this.socket?.readyState === OPEN) {
      this.socket.send(JSON.stringify(message));
      if (message.type === "subscribe") this.log(`[finnhub] subscribed ${message.symbol}`);
    }
  }

  private closeSocket(reason: string) {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      try {
        socket.close(1000, reason);
      } catch {
        // already closed
      }
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private clearIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

export const finnhubSocket = new FinnhubSocket({
  apiKey: env.finnhubApiKey,
  log: __DEV__ ? (message) => console.log(message) : undefined,
});

const nullable = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Latest quote from Finnhub REST. Throws ApiError(404) for unknown symbols, 429 when rate limited. */
export async function fetchQuote(ticker: string, apiKey: string = env.finnhubApiKey): Promise<Quote> {
  if (!apiKey) throw new ApiError("Live prices are not configured", 503);
  let res: Response;
  try {
    res = await fetch(`${FINNHUB_REST_URL}/quote?symbol=${encodeURIComponent(toFinnhubSymbol(ticker))}`, {
      headers: { "X-Finnhub-Token": apiKey },
    });
  } catch {
    throw new ApiError("Network unavailable", 0);
  }
  if (res.status === 429) throw new ApiError("Price feed rate limit reached", 429);
  if (!res.ok) throw new ApiError(`Quote request failed (${res.status})`, res.status);
  const body = (await res.json()) as Record<string, unknown>;
  const current = nullable(body.c);
  // Finnhub answers unknown symbols with all-zero quotes.
  if (!current) throw new ApiError(`No quote available for ${ticker}`, 404);
  return {
    current,
    change: nullable(body.d),
    percentChange: nullable(body.dp),
    high: nullable(body.h),
    low: nullable(body.l),
    open: nullable(body.o),
    previousClose: nullable(body.pc),
    timestamp: nullable(body.t),
  };
}
