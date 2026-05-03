// Wraps text in the holographic gradient fill — applies the .holo-text
// class declared in globals.css under .landing-light scope.
import { cn } from "@/lib/utils/cn";

export function HoloText({
  children,
  className,
  italic = false,
  as: Tag = "span",
}: {
  children: React.ReactNode;
  className?: string;
  italic?: boolean;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  // Cast required because dynamic JSX tags can't infer prop types here.
  const Component = Tag as React.ElementType;
  return (
    <Component
      className={cn("holo-text", italic && "italic", className)}
      style={italic ? { fontStyle: "italic" } : undefined}
    >
      {children}
    </Component>
  );
}
