const TOKEN_DECIMALS = 6;

export function formatTokenAmount(rawAmount: string | number, symbol?: string): string {
  const n = typeof rawAmount === "string" ? BigInt(rawAmount) : BigInt(Math.round(Number(rawAmount)));
  const divisor = BigInt(10 ** TOKEN_DECIMALS);
  const whole = n / divisor;
  const fraction = n % divisor;
  const fracStr = fraction.toString().padStart(TOKEN_DECIMALS, "0").replace(/0+$/, "");
  const formatted = fracStr
    ? `${whole.toLocaleString()}.${fracStr}`
    : whole.toLocaleString();
  return symbol ? `${formatted} ${symbol}` : formatted;
}

export function parseTokenAmount(humanAmount: string): string {
  const [whole, frac = ""] = humanAmount.split(".");
  const paddedFrac = frac.slice(0, TOKEN_DECIMALS).padEnd(TOKEN_DECIMALS, "0");
  return (BigInt(whole || "0") * BigInt(10 ** TOKEN_DECIMALS) + BigInt(paddedFrac)).toString();
}
