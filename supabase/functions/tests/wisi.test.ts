import { assertEquals } from "jsr:@std/assert@1";
import { directionFactor, isExecutiveTitle, roleMultiplier } from "../_shared/wisi.ts";

// Same table as supabase/verification/02_automated_checks.sql so the SQL and
// TypeScript implementations cannot drift apart silently.
const ROLE_CASES: [string | null, number][] = [
  ["Chief Executive Officer", 1.5],
  ["President and CEO", 1.5],
  ["Co-CEO", 1.5],
  ["Chief Financial Officer & Treasurer", 1.5],
  ["EVP and CFO", 1.5],
  ["Principal Financial Officer", 1.5],
  ["Chairman & Chief Executive Officer", 1.5],
  ["Director", 1.0],
  ["Chairman of the Board", 1.0],
  ["Executive Chair", 1.0],
  ["President, Director", 1.0],
  ["10% Owner", 0.7],
  ["10 percent owner", 0.7],
  ["Chief Operating Officer", 0.7],
  ["EVP, General Counsel", 0.7],
  ["SVP, Worldwide Sales", 0.7],
  ["Senior Vice President, Retail", 0.7],
  ["Principal Accounting Officer", 0.7],
  ["Head of Retail, Officer", 0.7],
  ["Member of 13(d) group", 0.5],
  ["", 0.5],
  [null, 0.5],
];

Deno.test("role multipliers match the SQL implementation", () => {
  for (const [title, expected] of ROLE_CASES) {
    assertEquals(roleMultiplier(title), expected, `roleMultiplier(${JSON.stringify(title)})`);
  }
});

Deno.test("direction factors", () => {
  assertEquals(["P", "p", "S", "A", "M", "G", "F", "", null].map(directionFactor), [1, 1, -1, 0, 0, 0, 0, 0, 0]);
});

Deno.test("executive titles", () => {
  assertEquals(isExecutiveTitle("Chief Executive Officer, Director"), true);
  assertEquals(isExecutiveTitle("Director"), false);
  assertEquals(isExecutiveTitle("10% Owner"), false);
});
