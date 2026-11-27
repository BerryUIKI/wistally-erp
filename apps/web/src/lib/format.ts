/** Display helpers for exact decimal strings coming from the API. */

/** "10.500000" → "10.5", "0.000000" → "0". */
export function trimZeros(value: string): string {
  if (!value.includes('.')) {
    return value;
  }
  return value.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Renders a six-decimal money string at two decimals with banker's rounding,
 * without going through a float.
 */
export function formatMoney(value: string): string {
  const decimals = 2;
  const negative = value.startsWith('-');
  const digits = negative ? value.slice(1) : value;
  const [whole = '0', fraction = ''] = digits.split('.');
  const padded = fraction.padEnd(decimals + 1, '0');
  const kept = padded.slice(0, decimals);
  const next = padded.charAt(decimals);

  let scaled = BigInt(`${whole}${kept}`);
  if (next > '5' || (next === '5' && scaled % 2n === 1n)) {
    scaled += 1n;
  }

  const text = scaled.toString().padStart(decimals + 1, '0');
  const integer = text.slice(0, text.length - decimals);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const rendered = `${grouped}.${text.slice(text.length - decimals)}`;
  return negative && scaled !== 0n ? `-${rendered}` : rendered;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
