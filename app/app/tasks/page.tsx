import { redirect } from "next/navigation";

// Tasks land per-class on /app/classes/[id]?tab=assignments. The tab key
// stays "assignments" because it maps to the schema-level table name; the
// user-facing label has shifted from "Assignments" to "Tasks" per the JP
// α copy revision.
export default function TasksRedirect() {
  redirect("/app/classes");
}
