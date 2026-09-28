import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  describeOwnerTitle,
  type Form4Owner,
  Form4ParseError,
  parseForm4Xml,
  summarizeForm4,
} from "../_shared/form4.ts";

const fixture = (accession: string) =>
  Deno.readTextFileSync(new URL(`./fixtures/form4_${accession}.xml`, import.meta.url));

const summarize = (accession: string) => summarizeForm4(parseForm4Xml(fixture(accession)));

Deno.test("parses issuer, owners and every transaction line", () => {
  const doc = parseForm4Xml(fixture("0001104659-26-106432"));
  assertEquals(doc.documentType, "4");
  assertEquals(doc.issuer, { cik: "0001318605", name: "Tesla, Inc.", ticker: "TSLA" });
  assertEquals(doc.owners.length, 1);
  assertEquals(doc.owners[0].name, "Taneja Vaibhav");
  assertEquals(doc.owners[0].isOfficer, true);
  assertEquals(doc.owners[0].officerTitle, "Chief Financial Officer");
  assertEquals(doc.transactions.map((t) => `${t.table}:${t.code}`), [
    "nonDerivative:M",
    "nonDerivative:S",
    "derivative:M",
  ]);
  assertEquals(doc.transactions[1].shares, 2605.75); // fractional shares survive
});

Deno.test("CFO sell-to-cover: the open-market sale outranks the exercise", () => {
  assertEquals(summarize("0001104659-26-106432"), {
    reportingOwnerName: "Taneja Vaibhav",
    ownerTitle: "Chief Financial Officer",
    transactionCode: "S",
    shares: 2605.75,
    pricePerShare: 360.134,
    totalValue: 938419.17,
    transactionDate: "2026-09-08",
    isDirect: true,
    postTransactionShares: 25972.25,
    lineCount: 1,
  });
});

Deno.test("CEO exercise-and-sell aggregates both sale lines", () => {
  const s = summarize("0001628280-26-063572")!;
  assertEquals(s.ownerTitle, "Chief Executive Officer, Director");
  assertEquals(s.transactionCode, "S");
  assertEquals(s.shares, 12946);
  assertEquals(s.pricePerShare, 190);
  assertEquals(s.totalValue, 2459740);
  assertEquals(s.lineCount, 2);
});

Deno.test("29 purchase fills collapse into one share-weighted purchase", () => {
  const s = summarize("0001213900-26-103430")!;
  assertEquals(s.transactionCode, "P");
  assertEquals(s.ownerTitle, "CEO");
  assertEquals(s.lineCount, 29);
  assertEquals(s.shares, 10000);
  assertEquals(s.totalValue, 5863);
  assertEquals(s.pricePerShare, 0.5863);
  assertEquals(s.transactionDate, "2026-09-25"); // latest fill
});

Deno.test("joint filing: true/false flags, 10% owner, indirect holdings", () => {
  const s = summarize("0001193125-26-403089")!;
  assertEquals(s.reportingOwnerName, "BERKSHIRE HATHAWAY INC +1 more");
  assertEquals(s.ownerTitle, "10% Owner");
  assertEquals(s.transactionCode, "P");
  assertEquals(s.shares, 1679700);
  assertEquals(s.totalValue, 136382789.45);
  assertEquals(s.isDirect, false);
});

Deno.test("seven reporting owners combine director and 10% owner roles", () => {
  const s = summarize("0001104659-26-110960")!;
  assertEquals(s.reportingOwnerName, "AE RED HOLDINGS, LLC +6 more");
  assertEquals(s.ownerTitle, "Director, 10% Owner");
  assertEquals(s.transactionCode, "S");
  assertEquals(s.totalValue, 10539792.9);
});

Deno.test("sales outrank a gift in the same filing", () => {
  const s = summarize("0001104659-26-110983")!;
  assertEquals(s.transactionCode, "S");
  assertEquals(s.lineCount, 16);
  assertEquals(s.shares, 702190);
  assertEquals(s.totalValue, 250006183.62);
});

Deno.test("derivative-only filings fall back to the derivative table", () => {
  const s = summarize("0001683168-26-007423")!;
  assertEquals(s.transactionCode, "A");
  assertEquals(s.shares, 32032);
  assertEquals(s.pricePerShare, 0);
  assertEquals(s.totalValue, 0);
  assertEquals(s.ownerTitle, "Chief Operating Officer");
});

Deno.test("non open-market codes are kept as-is (tax withholding F, exercise M)", () => {
  assertEquals(summarize("0001845661-26-000003")?.transactionCode, "F");
  const m = summarize("0001972928-26-000002")!;
  assertEquals(m.transactionCode, "M");
  assertEquals(m.totalValue, 411400);
  assertEquals(m.ownerTitle, "SVP");
});

Deno.test("director purchase", () => {
  const s = summarize("0001180645-26-000001")!;
  assertEquals([s.transactionCode, s.ownerTitle, s.shares, s.pricePerShare], ["P", "Director", 20000, 2.22]);
});

Deno.test("filings without transactions summarise to null", () => {
  const xml = `<?xml version="1.0"?><ownershipDocument><documentType>4</documentType>
    <issuer><issuerCik>0000000001</issuerCik></issuer>
    <reportingOwner><reportingOwnerId><rptOwnerName>X</rptOwnerName></reportingOwnerId></reportingOwner>
    <nonDerivativeTable><nonDerivativeHolding><securityTitle><value>Common</value></securityTitle></nonDerivativeHolding></nonDerivativeTable>
  </ownershipDocument>`;
  assertEquals(summarizeForm4(parseForm4Xml(xml)), null);
});

Deno.test("missing price footnote-only values are treated as $0", () => {
  const xml = `<ownershipDocument><issuer><issuerCik>1</issuerCik></issuer>
    <reportingOwner><reportingOwnerId><rptOwnerName>A &amp; B Trust</rptOwnerName></reportingOwnerId></reportingOwner>
    <nonDerivativeTable><nonDerivativeTransaction>
      <transactionDate><value>2026-01-02</value></transactionDate>
      <transactionCoding><transactionCode>G</transactionCode></transactionCoding>
      <transactionAmounts><transactionShares><value>1,000</value></transactionShares>
        <transactionPricePerShare><footnoteId id="F1"/></transactionPricePerShare></transactionAmounts>
    </nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
  const s = summarizeForm4(parseForm4Xml(xml))!;
  assertEquals([s.reportingOwnerName, s.transactionCode, s.shares, s.pricePerShare], ["A & B Trust", "G", 1000, 0]);
});

Deno.test("rejects documents that are not Form 4 XML", () => {
  assertThrows(() => parseForm4Xml("<html><body>Not found</body></html>"), Form4ParseError);
});

Deno.test("owner titles: officers without a recognisable title are marked", () => {
  const base: Form4Owner = {
    cik: null,
    name: "X",
    isDirector: false,
    isOfficer: true,
    isTenPercentOwner: false,
    isOther: false,
    officerTitle: null,
    otherText: null,
  };
  assertEquals(describeOwnerTitle([base]), "Officer");
  assertEquals(describeOwnerTitle([{ ...base, officerTitle: "Head of Retail" }]), "Head of Retail (Officer)");
  assertEquals(describeOwnerTitle([{ ...base, isOfficer: false, isOther: true, otherText: "Former director" }]), "Former director");
  assertEquals(describeOwnerTitle([{ ...base, isOfficer: false }]), null);
});
