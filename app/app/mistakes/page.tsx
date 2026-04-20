import { redirect } from "next/navigation";

// Folded into /app/classes/[id]?tab=mistakes per REDESIGN §4.1/§4.5.
export default function MistakesRedirect() {
  redirect("/app/classes");
}
