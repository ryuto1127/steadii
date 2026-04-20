import { redirect } from "next/navigation";

// Folded into /app/classes/[id]?tab=syllabus per REDESIGN §4.1/§4.5.
export default function SyllabusRedirect() {
  redirect("/app/classes");
}
