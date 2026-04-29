import "server-only";

// Sent to the admin (default ADMIN_EMAIL = hello@mysteadii.com, forwarded
// onward via improvmx) when someone submits the public /request-access
// form for the first time. Re-submissions of the same email are silently
// merged at the DB layer (unique index), so this notification only fires
// for genuinely new requests.

export type AdminNewRequestTemplateInput = {
  email: string;
  name: string | null;
  university: string | null;
  reason: string | null;
  requestedAt: Date;
  appUrl: string;
};

export type AdminNewRequestTemplate = {
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
};

export function buildAdminNewRequestEmail(
  input: AdminNewRequestTemplateInput
): AdminNewRequestTemplate {
  const adminUrl = `${stripTrailingSlash(input.appUrl)}/app/admin/waitlist`;
  const dash = (s: string | null) => (s && s.trim() ? s : "—");

  const text = [
    "New α access request received.",
    "",
    `Email:        ${input.email}`,
    `Name:         ${dash(input.name)}`,
    `University:   ${dash(input.university)}`,
    `Reason:       ${dash(input.reason)}`,
    `Submitted:    ${input.requestedAt.toISOString()}`,
    "",
    "Review and approve at:",
    `  ${adminUrl}`,
    "",
    "— Steadii",
  ].join("\n");

  const escapedUrl = escapeHtml(adminUrl);
  const escapedText = escapeHtml(text).replace(
    escapeHtml(adminUrl),
    `<a href="${escapedUrl}">${escapedUrl}</a>`
  );
  const html = `<pre style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0;">${escapedText}</pre>`;

  return {
    from: "Steadii System <agent@mysteadii.com>",
    replyTo: "agent@mysteadii.com",
    subject: `[Steadii waitlist] New α access request — ${input.email}`,
    text,
    html,
  };
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
