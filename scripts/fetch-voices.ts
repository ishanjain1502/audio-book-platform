/**
 * One-off: list Fish public voices and print JSON for voices.json curation.
 * Run: FISH_API_KEY=... npx tsx scripts/fetch-voices.ts
 */
const base = process.env.FISH_BASE_URL ?? "https://api.fish.audio";

async function main() {
  const res = await fetch(`${base}/v1/references/list`, {
    headers: { Authorization: `Bearer ${process.env.FISH_API_KEY ?? ""}` },
  });
  console.log(await res.text());
}

main().catch(console.error);
