/**
 * Supabase schema types (mirrors supabase/migrations). Regenerate with
 * `npx supabase gen types typescript --linked > src/types/database.ts`
 * after changing the database.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12.2";
  };
  public: {
    Tables: {
      companies: {
        Row: {
          id: string;
          ticker: string;
          cik: string;
          company_name: string;
          market_cap: number | null;
          created_at: string;
          last_synced_at: string | null;
          market_cap_updated_at: string | null;
          market_cap_checked_at: string | null;
        };
        Insert: {
          id?: string;
          ticker: string;
          cik: string;
          company_name: string;
          market_cap?: number | null;
          created_at?: string;
          last_synced_at?: string | null;
          market_cap_updated_at?: string | null;
          market_cap_checked_at?: string | null;
        };
        Update: {
          id?: string;
          ticker?: string;
          cik?: string;
          company_name?: string;
          market_cap?: number | null;
          created_at?: string;
          last_synced_at?: string | null;
          market_cap_updated_at?: string | null;
          market_cap_checked_at?: string | null;
        };
        Relationships: [];
      };
      insider_transactions: {
        Row: {
          id: string;
          company_id: string;
          accession_number: string;
          filing_date: string;
          transaction_date: string;
          reporting_owner_name: string;
          owner_title: string | null;
          transaction_code: string;
          shares: number;
          price_per_share: number;
          total_value: number;
          is_direct: boolean | null;
          post_transaction_shares: number | null;
          created_at: string;
          insider_cik: string | null;
          is_10b5_1: boolean;
          is_sell_to_cover: boolean;
          /** Sale of shares just acquired by exercising options (exercise-and-sell). */
          is_option_sale: boolean;
          /** The filed price looks wrong (e.g. the total typed into the price field); never counts. */
          price_suspect: boolean;
          parser_version: number;
          /** +1 discretionary open-market buy, -1 discretionary open-market sale, 0 routine / other (generated). */
          signal_direction: number;
          /** Buys: % increase of the holding; sales: % of the holding sold (generated). */
          stake_change_pct: number | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          accession_number: string;
          filing_date: string;
          transaction_date: string;
          reporting_owner_name: string;
          owner_title?: string | null;
          transaction_code: string;
          shares: number;
          price_per_share: number;
          total_value?: never;
          is_direct?: boolean | null;
          post_transaction_shares?: number | null;
          created_at?: string;
          insider_cik?: string | null;
          is_10b5_1?: boolean;
          is_sell_to_cover?: boolean;
          is_option_sale?: boolean;
          price_suspect?: boolean;
          parser_version?: number;
          signal_direction?: never;
          stake_change_pct?: never;
        };
        Update: {
          id?: string;
          company_id?: string;
          accession_number?: string;
          filing_date?: string;
          transaction_date?: string;
          reporting_owner_name?: string;
          owner_title?: string | null;
          transaction_code?: string;
          shares?: number;
          price_per_share?: number;
          total_value?: never;
          is_direct?: boolean | null;
          post_transaction_shares?: number | null;
          created_at?: string;
          insider_cik?: string | null;
          is_10b5_1?: boolean;
          is_sell_to_cover?: boolean;
          is_option_sale?: boolean;
          price_suspect?: boolean;
          parser_version?: number;
          signal_direction?: never;
          stake_change_pct?: never;
        };
        Relationships: [
          {
            foreignKeyName: "insider_transactions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      sentiment_scores: {
        Row: {
          id: string;
          company_id: string;
          wisi_score: number;
          last_updated: string;
          net_weighted_value: number;
          buy_count: number;
          sell_count: number;
          sentiment_index: number | null;
          sentiment_label: string | null;
          signal_score: number;
          signal_label: string;
          signal_buyers: number;
          signal_sellers: number;
          signal_buy_value: number;
          signal_sell_value: number;
          signal_cluster_points: number;
          signal_last_trade_date: string | null;
        };
        Insert: {
          id?: string;
          company_id: string;
          wisi_score?: number;
          last_updated?: string;
          net_weighted_value?: number;
          buy_count?: number;
          sell_count?: number;
          sentiment_index?: never;
          sentiment_label?: never;
          signal_score?: number;
          signal_label?: string;
          signal_buyers?: number;
          signal_sellers?: number;
          signal_buy_value?: number;
          signal_sell_value?: number;
          signal_cluster_points?: number;
          signal_last_trade_date?: string | null;
        };
        Update: {
          id?: string;
          company_id?: string;
          wisi_score?: number;
          last_updated?: string;
          net_weighted_value?: number;
          buy_count?: number;
          sell_count?: number;
          sentiment_index?: never;
          sentiment_label?: never;
          signal_score?: number;
          signal_label?: string;
          signal_buyers?: number;
          signal_sellers?: number;
          signal_buy_value?: number;
          signal_sell_value?: number;
          signal_cluster_points?: number;
          signal_last_trade_date?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sentiment_scores_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      watchlists: {
        Row: {
          id: string;
          user_id: string;
          company_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          company_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          company_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "watchlists_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          expo_push_token: string | null;
          push_platform: string | null;
          whale_alerts_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          expo_push_token?: string | null;
          push_platform?: string | null;
          whale_alerts_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          expo_push_token?: string | null;
          push_platform?: string | null;
          whale_alerts_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      register_push_token: {
        Args: { p_token: string; p_platform: string };
        Returns: undefined;
      };
      get_insider_activity: {
        Args: { target_company_id: string; months?: number };
        Returns: {
          period_start: string;
          buy_value: number;
          sell_value: number;
          buy_shares: number;
          sell_shares: number;
          buy_count: number;
          sell_count: number;
          routine_sell_value: number;
          routine_sell_count: number;
        }[];
      };
      company_signal_breakdown: {
        Args: { target_company_id: string; as_of?: string };
        Returns: {
          insider_key: string;
          insider_name: string;
          insider_title: string | null;
          direction: number;
          trade_count: number;
          shares: number;
          total_value: number;
          weighted_value: number;
          avg_price: number | null;
          stake_change_pct: number | null;
          first_trade_date: string;
          last_trade_date: string;
          role_weight: number;
          size_factor: number;
          conviction: number;
          points: number;
        }[];
      };
      company_signal: {
        Args: { target_company_id: string; as_of?: string };
        Returns: {
          score: number;
          label: string;
          buyers: number;
          sellers: number;
          buy_value: number;
          sell_value: number;
          buy_points: number;
          sell_points: number;
          cluster_points: number;
          last_trade_date: string | null;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicTables = Database["public"]["Tables"];
export type Tables<T extends keyof PublicTables> = PublicTables[T]["Row"];
