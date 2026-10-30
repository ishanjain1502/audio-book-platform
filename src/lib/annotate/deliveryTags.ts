export type DeliveryToken = { kind: "text" | "tag"; value: string };

const BRACKET = /\[[^\[\]\n]+\]/;
const PAIRED = /<([A-Za-z]+)>[\s\S]*?<\/\1>/;

export function splitDeliveryTags(text: string): DeliveryToken[] {
  const tokens: DeliveryToken[] = [];
  let index = 0;
  let plain = "";

  while (index < text.length) {
    const rest = text.slice(index);
    const candidates = [BRACKET.exec(rest), PAIRED.exec(rest)].flatMap((match) =>
      match ? [{ at: match.index, value: match[0] }] : [],
    );
    if (candidates.length === 0) {
      plain += rest;
      break;
    }
    candidates.sort((a, b) => a.at - b.at);
    const next = candidates[0];
    plain += rest.slice(0, next.at);
    if (plain.length > 0) {
      tokens.push({ kind: "text", value: plain });
      plain = "";
    }
    tokens.push({ kind: "tag", value: next.value });
    index += next.at + next.value.length;
  }

  if (plain.length > 0) tokens.push({ kind: "text", value: plain });
  return tokens;
}
