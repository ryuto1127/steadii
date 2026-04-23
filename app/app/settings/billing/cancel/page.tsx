import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { CancelForm } from "./cancel-form";

export const dynamic = "force-dynamic";

// Two-step cancel flow — see project_decisions.md:
//   Step 1: optional reason picker (NO retention offers)
//   Step 2: confirmation + grace-period explanation
// Implemented in a single page; the CancelForm component owns the
// step state client-side so both steps share context without routing.
export default async function CancelPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [sub] = await db
    .select({
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, session.user.id))
    .limit(1);

  if (!sub || sub.status !== "active") notFound();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="text-h1">Cancel subscription</h1>
      <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
        {sub.cancelAtPeriodEnd === 1
          ? "Your subscription is already set to cancel at the end of the current period."
          : "Before you go — one optional question to help us improve. You can skip it."}
      </p>

      {sub.cancelAtPeriodEnd !== 1 && (
        <CancelForm
          currentPeriodEnd={
            sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null
          }
        />
      )}
    </div>
  );
}
