import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  resend,
  ResendNotConfiguredError,
} from "@/lib/integrations/resend/client";
import { env } from "@/lib/env";
import { buildAccessApprovedEmail } from "@/lib/integrations/resend/templates/access-approved";
import { buildAdminNewRequestEmail } from "@/lib/integrations/resend/templates/admin-new-request";

// Send the "α access approved" email to the user. Returns true on a
// successful Resend dispatch, false when Resend is unconfigured (dev
// without RESEND_API_KEY) so the caller can skip the emailSentAt
// stamp.
export async function sendAccessApprovedEmail(args: {
  to: string;
  name: string | null;
  inviteUrl: string;
}): Promise<boolean> {
  const tpl = buildAccessApprovedEmail({
    name: args.name,
    inviteUrl: args.inviteUrl,
  });
  try {
    const result = await resend().emails.send({
      from: tpl.from,
      to: args.to,
      replyTo: tpl.replyTo,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    if (result.error) {
      throw new Error(
        `Resend rejected approved-email send: ${result.error.name} — ${result.error.message}`
      );
    }
    return true;
  } catch (err) {
    if (err instanceof ResendNotConfiguredError) {
      console.warn("[waitlist] RESEND_API_KEY not set; skipping approved email");
      return false;
    }
    throw err;
  }
}

// Best-effort admin notification on a new public request. NEVER throws —
// the user's submission must succeed even if the notification fails.
export async function sendAdminNewRequestEmail(args: {
  email: string;
  name: string | null;
  university: string | null;
  reason: string | null;
  requestedAt: Date;
}): Promise<void> {
  try {
    const tpl = buildAdminNewRequestEmail({
      ...args,
      appUrl: env().APP_URL,
    });
    const result = await resend().emails.send({
      from: tpl.from,
      to: env().ADMIN_EMAIL,
      replyTo: tpl.replyTo,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    });
    if (result.error) {
      throw new Error(
        `Resend rejected admin notify: ${result.error.name} — ${result.error.message}`
      );
    }
  } catch (err) {
    if (err instanceof ResendNotConfiguredError) {
      console.warn("[waitlist] RESEND_API_KEY not set; skipping admin notify");
      return;
    }
    Sentry.captureException(err, {
      tags: { feature: "waitlist_admin_notify" },
    });
  }
}
