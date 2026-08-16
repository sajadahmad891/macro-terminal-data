/**
 * refresh-macro-data.mjs
 * -----------------------------------------------------------------
 * Run by .github/workflows/refresh-macro-data.yml on GitHub's servers.
 * Calls the Claude API with web search enabled, asks it to research
 * current central-bank rates, inflation/employment prints, the latest
 * CFTC COT report, upcoming calendar events, and recent market-moving
 * news — then writes the result to data/macro-data.json, which the
 * workflow commits back to the repo.
 *
 * Requires the ANTHROPIC_API_KEY secret to be set on the repo
 * (Settings → Secrets and variables → Actions).
 * -----------------------------------------------------------------
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Check https://docs.claude.com for the current model id — model names
// change over time and this one may be stale by the time you run this.
const MODEL = "claude-sonnet-4-6";

const CURRENCIES = ["USD","EUR","GBP","JPY","CHF","AUD","CAD","NZD","XAU","XAG","BTC","ETH"];

const SCHEMA_DESCRIPTION = `
Return ONLY a single JSON object (no markdown fences, no commentary) with this exact shape:

{
  "generatedAt": "<ISO 8601 timestamp of when you researched this>",
  "asOfLabel": "<human label e.g. 'AS OF 20 AUG 2026'>",
  "fundamentals": {
    "<CCY>": {
      "rate": "<current policy rate or 'n/a' for BTC/ETH>",
      "changed": "<short string on when/how it last changed>",
      "stance": "hawk" | "dove" | "hold" | "mixed",
      "rateHistory": [6 numbers, oldest to newest, monthly, policy rate only — omit for XAU/XAG/BTC/ETH],
      "supports": ["short factual bullet", "..."],
      "caps": ["short factual bullet", "..."],
      "indicators": [
        {"name":"<factor name>", "score": <0-100 int, 50=neutral>, "trend": "up"|"down"|"flat"|null, "detail":"<one sentence, factual>"}
        // 5-7 indicators per currency; for USD/EUR/GBP/JPY/CHF/AUD/CAD/NZD use:
        // Policy Rate, Inflation (CPI), Employment, Growth Momentum, Trade Balance, Confidence / PMI, COT Positioning
        // for XAU/XAG use commodity-appropriate factors (Central-Bank Buying, Safe-Haven, Real-Yield Pressure, ETF Demand, COT)
        // for BTC/ETH use (ETF Flows, Institutional Accumulation, Market Structure, Regulatory Environment, Macro/Risk Sentiment)
      ],
      "cot": {"asof":"<week ending date>", "net":"<plain description>", "change":"<plain description>", "oi":"<open interest note or n/a>", "percentile":"<historical percentile note or n/a>", "interp":"<1-2 sentence interpretation>"}
    }
    // one entry per currency in this list: ${CURRENCIES.join(", ")}
  },
  "calendar": [
    {"date":"<e.g. 'Tue 19 Aug'>", "dt":"<YYYY-MM-DD>", "time":"<e.g. '08:30 ET' or '—'>", "cur":"<CCY>", "impact":"high"|"med"|"low",
     "event":"<event name>", "prev":"<prior reading / context>", "pairs":["<affected pairs>"], "meaning":"<what a beat vs miss means, plain HTML with <b class='g'> for bullish and <b class='r'> for bearish spans>"}
    // ONLY events that are genuinely still upcoming relative to today — 8-12 of them over the next ~5 weeks
  ],
  "news": [
    {"dt":"<YYYY-MM-DD>", "cur":"<CCY>", "impact":"high"|"med"|"low", "headline":"<short headline, your own words>",
     "body":"<1-2 sentence paraphrase in your own words, no verbatim quotes over a few words>", "src":"<publication or 'Central bank statement'>", "url":"<real URL if you have one from search results, else omit>"}
    // 8-15 recent, real, dated items from the last ~2-3 weeks
  ]
}

Rules:
- Every fact must come from an actual web search you perform in this call — do not rely on memory for anything time-sensitive (rates, CPI prints, COT figures, news).
- Do not fabricate precise numbers you didn't actually find. If you can't find a specific figure, use a qualitative description instead and say so in the "detail"/"interp" field.
- Double-check dates: only include calendar events that have NOT happened yet as of today.
- Keep "supports"/"caps" to 2-4 bullets each, factual, no hype.
- Keep prose fields concise — this feeds a dashboard, not a report.
- Paraphrase everything; never quote a source verbatim beyond a few words.
`;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (add it as a repo secret)");

  const today = new Date().toISOString().slice(0, 10);
  const prompt = `Today's date is ${today}. Research current macro fundamentals for these assets: ${CURRENCIES.join(", ")} (XAU=gold, XAG=silver, BTC/ETH=crypto). Use web search for anything time-sensitive: current central bank policy rates and latest decisions, latest inflation (CPI) and employment prints, the most recent CFTC Commitments of Traders report, upcoming high/medium-impact economic releases over the next ~5 weeks, and recent (last 2-3 weeks) market-moving news per asset.\n\n${SCHEMA_DESCRIPTION}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Anthropic API error ${resp.status}: ${errText.slice(0, 800)}`);
  }

  const data = await resp.json();
  const text = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return a parseable JSON object. Raw text:\n" + text.slice(0, 1000));

  const parsed = JSON.parse(match[0]);
  parsed.generatedAt = parsed.generatedAt || new Date().toISOString();

  const outPath = fileURLToPath(new URL("../data/macro-data.json", import.meta.url));
  await writeFile(outPath, JSON.stringify(parsed, null, 2) + "\n");
  console.log("Wrote data/macro-data.json — generatedAt:", parsed.generatedAt);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
