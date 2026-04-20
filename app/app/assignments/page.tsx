import { redirect } from "next/navigation";

// Folded into /app/classes/[id]?tab=assignments per REDESIGN §4.1/§4.5.
export default function AssignmentsRedirect() {
  redirect("/app/classes");
}
