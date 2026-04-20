import { redirect } from "next/navigation";

// Moved to Settings → Resources per REDESIGN §4.1/§4.8.
export default function ResourcesRedirect() {
  redirect("/app/settings");
}
