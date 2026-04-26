import { redirect } from "next/navigation";

// Renamed user-facing surface to "Tasks" per the JP α copy revision. The
// schema/table stays `assignments`. Old URLs land here and bounce so any
// in-flight bookmark / share-link / email-deep-link still works.
export default function AssignmentsRedirect() {
  redirect("/app/tasks");
}
