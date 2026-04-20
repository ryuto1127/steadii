export function parseNotionId(input: string): string | null {
  const hyphen = input.match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/
  );
  if (hyphen) return hyphen[0];
  const raw = input.match(/[0-9a-fA-F]{32}/);
  if (!raw) return null;
  const r = raw[0];
  return `${r.slice(0, 8)}-${r.slice(8, 12)}-${r.slice(12, 16)}-${r.slice(16, 20)}-${r.slice(20)}`;
}
