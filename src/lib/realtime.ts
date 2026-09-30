/** Supabase Realtime helpers. */

let channelSeq = 0;

/**
 * A fresh channel topic per subscription. realtime-js hands back the existing
 * channel for a topic that is still leaving after removeChannel(), and that
 * channel never subscribes again (e.g. going back and straight into the same
 * company).
 */
export function uniqueTopic(base: string): string {
  channelSeq += 1;
  return `${base}:${channelSeq}`;
}
