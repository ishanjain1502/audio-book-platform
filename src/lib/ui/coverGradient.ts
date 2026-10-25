function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function coverGradientFromSeed(seed: string): { from: string; to: string } {
  const h = hashString(seed);
  const hue = h % 360;
  const from = hslToHex(hue, 0.55, 0.35);
  const to = hslToHex((hue + 40) % 360, 0.6, 0.22);
  return { from, to };
}
