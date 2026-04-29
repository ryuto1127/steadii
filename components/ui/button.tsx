import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
  secondary:
    "border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-raised))]",
  ghost:
    "text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-raised))]",
  destructive:
    "bg-[hsl(var(--destructive))] text-[hsl(var(--primary-foreground))] hover:opacity-90",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-9 px-3 text-small",
  md: "h-9 px-3.5 text-body",
  lg: "h-11 px-5 text-body",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, children, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-hover disabled:cursor-not-allowed disabled:opacity-50",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export function LinkButton({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-hover",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </Link>
  );
}
