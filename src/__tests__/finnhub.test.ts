import { FinnhubSocket, toFinnhubSymbol } from "../lib/finnhub";

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: { code?: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  receive(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

function makeSocket() {
  FakeSocket.instances = [];
  return new FinnhubSocket({
    apiKey: "test-key",
    createSocket: (url) => new FakeSocket(url),
    idleCloseMs: 1000,
    maxBackoffMs: 4000,
  });
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("maps SEC share classes to Finnhub symbols", () => {
  expect(toFinnhubSymbol("brk-b")).toBe("BRK.B");
});

it("connects lazily, subscribes on open and routes trades to listeners", () => {
  const socket = makeSocket();
  const trades: number[] = [];
  socket.subscribe("AAPL", (t) => trades.push(t.price));
  const ws = FakeSocket.instances[0];
  expect(ws.url).toBe("wss://ws.finnhub.io?token=test-key");

  ws.open();
  expect(ws.sent).toEqual([{ type: "subscribe", symbol: "AAPL" }]);
  expect(socket.getStatus()).toBe("open");

  ws.receive({ type: "trade", data: [{ s: "AAPL", p: 340.5, v: 10, t: 1 }, { s: "MSFT", p: 500, v: 1, t: 1 }] });
  ws.receive({ type: "ping" });
  expect(trades).toEqual([340.5]);
});

it("shares one subscription per symbol and unsubscribes after the last listener", () => {
  const socket = makeSocket();
  const unsubA = socket.subscribe("TSLA", () => {});
  const unsubB = socket.subscribe("TSLA", () => {});
  const ws = FakeSocket.instances[0];
  ws.open();
  expect(ws.sent).toEqual([{ type: "subscribe", symbol: "TSLA" }]);

  unsubA();
  expect(ws.sent).toHaveLength(1);
  unsubB();
  expect(ws.sent).toEqual([
    { type: "subscribe", symbol: "TSLA" },
    { type: "unsubscribe", symbol: "TSLA" },
  ]);

  jest.advanceTimersByTime(1000);
  expect(socket.getStatus()).toBe("idle");
});

it("reconnects with backoff and re-subscribes after a dropped connection", () => {
  const socket = makeSocket();
  socket.subscribe("NVDA", () => {});
  FakeSocket.instances[0].open();
  FakeSocket.instances[0].drop();
  expect(socket.getStatus()).toBe("reconnecting");
  expect(FakeSocket.instances).toHaveLength(1);

  jest.advanceTimersByTime(1500);
  expect(FakeSocket.instances).toHaveLength(2);
  FakeSocket.instances[1].open();
  expect(FakeSocket.instances[1].sent).toEqual([{ type: "subscribe", symbol: "NVDA" }]);
});

it("pauses while offline and resumes with the same subscriptions", () => {
  const socket = makeSocket();
  socket.subscribe("AMD", () => {});
  FakeSocket.instances[0].open();

  socket.pause();
  expect(socket.getStatus()).toBe("paused");
  jest.advanceTimersByTime(60_000);
  expect(FakeSocket.instances).toHaveLength(1);

  socket.resume();
  expect(FakeSocket.instances).toHaveLength(2);
  FakeSocket.instances[1].open();
  expect(FakeSocket.instances[1].sent).toEqual([{ type: "subscribe", symbol: "AMD" }]);
});

it("reports unavailable without an API key", () => {
  const socket = new FinnhubSocket({ apiKey: "", createSocket: (url) => new FakeSocket(url) });
  socket.subscribe("AAPL", () => {});
  expect(socket.getStatus()).toBe("unavailable");
});
