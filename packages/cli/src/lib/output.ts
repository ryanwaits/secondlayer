// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
} as const;

export function red(text: string): string {
  return `${colors.red}${text}${colors.reset}`;
}

export function green(text: string): string {
  return `${colors.green}${text}${colors.reset}`;
}

export function yellow(text: string): string {
  return `${colors.yellow}${text}${colors.reset}`;
}

export function blue(text: string): string {
  return `${colors.blue}${text}${colors.reset}`;
}

export function magenta(text: string): string {
  return `${colors.magenta}${text}${colors.reset}`;
}

export function cyan(text: string): string {
  return `${colors.cyan}${text}${colors.reset}`;
}

export function dim(text: string): string {
  return `${colors.dim}${text}${colors.reset}`;
}

export function bold(text: string): string {
  return `${colors.bold}${text}${colors.reset}`;
}

export function success(message: string): void {
  console.log(green(`✓ ${message}`));
}

export function error(message: string): void {
  console.error(red(`✗ ${message}`));
}

export function warn(message: string): void {
  console.log(yellow(`⚠ ${message}`));
}

export function info(message: string): void {
  console.log(blue(`ℹ ${message}`));
}

// Strip ANSI codes for length calculation
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

export function formatTable(headers: string[], rows: string[][]): string {
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const colValues = [h, ...rows.map((r) => r[i] || "")];
    return Math.max(...colValues.map((v) => stripAnsi(v).length));
  });

  // Format header
  const headerRow = headers.map((h, i) => h.padEnd(widths[i]!)).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");

  // Format data rows
  const dataRows = rows.map((row) =>
    row.map((cell, i) => {
      const width = widths[i]!;
      const padding = width - stripAnsi(cell).length;
      return cell + " ".repeat(Math.max(0, padding));
    }).join("  ")
  );

  return [headerRow, separator, ...dataRows].join("\n");
}

export function formatKeyValue(pairs: [string, string][]): string {
  const maxKeyLen = Math.max(...pairs.map(([k]) => k.length));
  return pairs
    .map(([key, value]) => `${dim(key.padEnd(maxKeyLen))}  ${value}`)
    .join("\n");
}
