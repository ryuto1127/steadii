import { notFound } from "next/navigation";
import { Engineer39PreviewClient } from "./client";

// engineer-39 verification harness. Renders all three new surfaces
// (Contacts personas section, action items panel inside DraftDetailsPanel,
// pre-send warning modal) on a single route so engineer-side screenshots
// can capture EN + JA variants without needing a session cookie.
//
// Hard-gated behind NODE_ENV !== "production" so this never leaks to a
// deployed build. Bypasses auth — fine because it doesn't read user data.

export const dynamic = "force-dynamic";

export default async function Engineer39PreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const showModal = sp.modal === "1";
  return <Engineer39PreviewClient showModal={showModal} />;
}
