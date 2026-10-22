/** Loads the gzipped EDGAR 10-K / 10-Q fixtures in fixtures/filings (see its README). */

import { type FilingForm, findSections, type Paragraph, parseFilingHtml, splitParagraphs } from "../_shared/sectioner.ts";

const FIXTURES = new URL("./fixtures/filings/", import.meta.url);

export async function loadFiling(name: string): Promise<string> {
  const bytes = await Deno.readFile(new URL(`${name}.htm.gz`, FIXTURES));
  return await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
}

export function analyse(html: string, form: FilingForm) {
  const doc = parseFilingHtml(html);
  const sections = findSections(doc.text, form);
  const paragraphs = (key: "risk_factors" | "mdna"): Paragraph[] =>
    sections[key] ? splitParagraphs(sections[key]!, doc.emphasized) : [];
  return { doc, sections, risk: paragraphs("risk_factors"), mdna: paragraphs("mdna") };
}

const cache = new Map<string, Promise<ReturnType<typeof analyse>>>();

/** A fixture, parsed once per test run. */
export function fixture(name: string, form: FilingForm): Promise<ReturnType<typeof analyse>> {
  if (!cache.has(name)) cache.set(name, loadFiling(name).then((html) => analyse(html, form)));
  return cache.get(name)!;
}
