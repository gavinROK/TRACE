/**
 * Minimal CSV parser for the one documented shape this app accepts:
 * a header row naming columns, comma-separated, no quoted/escaped
 * commas. Good enough for a first version of "import software from a
 * CSV" — a real RFC 4180 parser is more than this needs right now.
 */
export function parseSimpleCsv(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];

  const headers = lines[0].split(",").map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}
