export type ClassColor =
  | "blue"
  | "green"
  | "orange"
  | "purple"
  | "red"
  | "gray"
  | "brown"
  | "pink";

export const CLASS_COLOR_HEX: Record<ClassColor, string> = {
  blue: "#3B82F6",
  green: "#10B981",
  orange: "#F97316",
  purple: "#8B5CF6",
  red: "#EF4444",
  gray: "#6B7280",
  brown: "#92400E",
  pink: "#EC4899",
};

export function normalizeClassColor(
  value: string | null | undefined
): ClassColor {
  if (!value) return "gray";
  const v = value.toLowerCase() as ClassColor;
  return v in CLASS_COLOR_HEX ? v : "gray";
}
