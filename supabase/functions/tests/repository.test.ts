import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransactionInsert } from "../_shared/ingest.ts";
import { SupabaseIngestRepository } from "../_shared/repository.ts";

type Result = { data?: unknown; error: null; count?: number };

/** Just enough of the supabase-js query builder for the calls under test. */
class FakeQuery {
  requestedRange: [number, number] | null = null;
  upserted: unknown[] | null = null;
  constructor(private readonly respond: (query: FakeQuery) => Result) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  not() {
    return this;
  }
  order() {
    return this;
  }
  range(from: number, to: number) {
    this.requestedRange = [from, to];
    return this;
  }
  upsert(rows: unknown[]) {
    this.upserted = rows;
    return this;
  }
  then<T>(resolve: (value: Result) => T, reject?: (reason: unknown) => T) {
    return Promise.resolve(this.respond(this)).then(resolve, reject);
  }
}

function fakeClient(respond: (query: FakeQuery) => Result) {
  const queries: FakeQuery[] = [];
  const client = {
    from() {
      const query = new FakeQuery(respond);
      queries.push(query);
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

Deno.test("whale alert recipients are paged past PostgREST's row cap, one per device", async () => {
  const { client, queries } = fakeClient((query) => {
    const [from] = query.requestedRange ?? [0, 0];
    const page = from === 0
      ? Array.from({ length: 500 }, (_, i) => ({ id: `user-${i}`, expo_push_token: `ExponentPushToken[t${i}]` }))
      : [
        { id: "user-500", expo_push_token: "ExponentPushToken[t500]" },
        // The same device stored on a second profile must not get two alerts.
        { id: "user-501", expo_push_token: "ExponentPushToken[t0]" },
      ];
    return { data: page, error: null };
  });

  const recipients = await new SupabaseIngestRepository(client).whaleAlertRecipients();
  assertEquals(recipients.length, 501);
  assertEquals(new Set(recipients.map((r) => r.token)).size, 501);
  assertEquals(queries.map((q) => q.requestedRange), [[0, 499], [500, 999]]);
});

Deno.test("transactions are written in company order, so concurrent writers lock companies alike", async () => {
  const { client, queries } = fakeClient((query) => ({ error: null, count: query.upserted?.length ?? 0 }));
  const row = (company_id: string, accession_number: string) => ({ company_id, accession_number }) as TransactionInsert;
  const written = await new SupabaseIngestRepository(client).upsertTransactions([
    row("c", "1"),
    row("a", "2"),
    row("b", "3"),
    row("a", "4"),
  ]);
  assertEquals(written, 4);
  assertEquals(
    (queries[0].upserted as TransactionInsert[]).map((r) => `${r.company_id}${r.accession_number}`),
    ["a2", "a4", "b3", "c1"],
  );
});
