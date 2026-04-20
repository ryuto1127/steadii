export type ConfirmationMode = "destructive_only" | "all" | "none";

export type ToolMutability = "read" | "write" | "destructive";

export function requiresConfirmation(
  mode: ConfirmationMode,
  mutability: ToolMutability
): boolean {
  if (mode === "none") return false;
  if (mode === "all") return mutability !== "read";
  return mutability === "destructive";
}
