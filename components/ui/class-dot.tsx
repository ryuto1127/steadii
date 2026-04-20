import { CLASS_COLOR_HEX, normalizeClassColor, type ClassColor } from "./class-color";

export function ClassDot({
  color,
  size = 6,
}: {
  color: ClassColor | string | null | undefined;
  size?: number;
}) {
  const normalized = normalizeClassColor(color);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{
        backgroundColor: CLASS_COLOR_HEX[normalized],
        width: size,
        height: size,
      }}
    />
  );
}
