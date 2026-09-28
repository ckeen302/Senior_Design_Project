/**
 * Live equity price for a ticker: Finnhub WebSocket trades when available,
 * otherwise the latest REST quote (cached for offline use). UI updates are
 * throttled so a busy symbol does not re-render on every trade.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { hasFinnhubKey } from "../config/env";
import { queryKeys } from "../lib/api";
import { ApiError } from "../lib/errors";
import { fetchQuote, finnhubSocket, type SocketStatus } from "../lib/finnhub";
import { useNetworkStatus } from "./useNetworkStatus";

export type PriceStatus = "live" | "delayed" | "offline" | "loading" | "unavailable" | "rate-limited" | "no-quote";

export interface LivePrice {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  updatedAt: number | null;
  status: PriceStatus;
}

const UI_THROTTLE_MS = 250;
const LIVE_WINDOW_MS = 5 * 60 * 1000;

export function useLivePrice(ticker: string | undefined): LivePrice {
  const { isOnline } = useNetworkStatus();
  const [socketStatus, setSocketStatus] = useState<SocketStatus>(finnhubSocket.getStatus());
  const [lastTrade, setLastTrade] = useState<{ price: number; timestamp: number } | null>(null);
  const pending = useRef<{ price: number; timestamp: number } | null>(null);

  const quote = useQuery({
    queryKey: queryKeys.quote(ticker ?? ""),
    queryFn: () => fetchQuote(ticker!),
    enabled: !!ticker && hasFinnhubKey,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (count, error) =>
      count < 2 && !(error instanceof ApiError && (error.status === 404 || error.status === 429 || error.status === 503)),
  });

  useEffect(() => {
    setLastTrade(null);
    if (!ticker || !hasFinnhubKey || !isOnline) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = finnhubSocket.subscribe(ticker, (trade) => {
      pending.current = { price: trade.price, timestamp: trade.timestamp };
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          if (pending.current) setLastTrade(pending.current);
        }, UI_THROTTLE_MS);
      }
    });
    const unsubscribeStatus = finnhubSocket.onStatus(setSocketStatus);
    setSocketStatus(finnhubSocket.getStatus());

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      unsubscribeStatus();
    };
  }, [ticker, isOnline]);

  const previousClose = quote.data?.previousClose ?? null;
  const price = lastTrade?.price ?? quote.data?.current ?? null;
  const change = price !== null && previousClose ? price - previousClose : quote.data?.change ?? null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const updatedAt = lastTrade?.timestamp ?? (quote.data?.timestamp ? quote.data.timestamp * 1000 : null);

  let status: PriceStatus;
  if (!hasFinnhubKey) status = "unavailable";
  else if (!isOnline) status = price !== null ? "offline" : "unavailable";
  else if (lastTrade && socketStatus === "open" && Date.now() - lastTrade.timestamp < LIVE_WINDOW_MS) status = "live";
  else if (price !== null) status = "delayed";
  else if (quote.error instanceof ApiError && quote.error.status === 429) status = "rate-limited";
  else if (quote.error instanceof ApiError && quote.error.status === 404) status = "no-quote";
  else if (quote.isLoading) status = "loading";
  else status = "unavailable";

  return { price, change, changePercent, previousClose, updatedAt, status };
}
