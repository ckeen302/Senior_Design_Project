/** Company detail data (profile, WISI score, filings, chart) with live updates. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  type CompanyDetail,
  fetchCompany,
  fetchCompanyTransactions,
  fetchInsiderActivity,
  queryKeys,
  type SentimentScore,
} from "../lib/api";
import { supabase } from "../lib/supabase";

export function useCompany(companyId: string) {
  return useQuery({ queryKey: queryKeys.company(companyId), queryFn: () => fetchCompany(companyId) });
}

export function useCompanyTransactions(companyId: string) {
  return useQuery({
    queryKey: queryKeys.companyTransactions(companyId),
    queryFn: () => fetchCompanyTransactions(companyId),
  });
}

export function useInsiderActivity(companyId: string, months: number) {
  return useQuery({
    queryKey: queryKeys.activity(companyId, months),
    queryFn: () => fetchInsiderActivity(companyId, months),
    staleTime: 5 * 60_000,
  });
}

/** Pushes WISI recalculations and new filings for one company into the cache. */
export function useCompanyRealtime(companyId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel(`company:${companyId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sentiment_scores", filter: `company_id=eq.${companyId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return;
          const score = payload.new as SentimentScore;
          queryClient.setQueryData<CompanyDetail>(queryKeys.company(companyId), (old) =>
            old ? { ...old, sentiment: { ...old.sentiment, ...score } } : old
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "insider_transactions", filter: `company_id=eq.${companyId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.companyTransactions(companyId) });
          queryClient.invalidateQueries({ queryKey: ["company", companyId, "activity"] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);
}
