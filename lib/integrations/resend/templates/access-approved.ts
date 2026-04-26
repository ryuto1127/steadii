import "server-only";

// Sent to the user once Ryuto approves their α access request. The from
// address is overridden to hello@ — this is a human-touch milestone, not
// an agent action — but the body keeps the bilingual JA-primary tone the
// rest of Steadii uses.
//
// `name` defaults to a neutral greeting when null/empty so we never send
// "Hi ," with a stranded comma.

export type AccessApprovedTemplateInput = {
  name: string | null;
  inviteUrl: string;
};

export type AccessApprovedTemplate = {
  from: string;
  replyTo: string;
  subject: string;
  text: string;
  html: string;
};

export function buildAccessApprovedEmail(
  input: AccessApprovedTemplateInput
): AccessApprovedTemplate {
  const trimmed = input.name?.trim() ?? "";
  const jaGreeting = trimmed ? `${trimmed}さん こんにちは、` : "こんにちは、";
  const enGreeting = trimmed ? `Hi ${trimmed},` : "Hi,";

  const text = [
    jaGreeting,
    "",
    "Steadii の α アクセスが承認されました。",
    "下のリンクからサインインしてください:",
    "",
    input.inviteUrl,
    "",
    "上のリンクには 3 ヶ月間 Pro 機能 (¥0) を含みます。",
    "サインイン後 14 日間の trial が始まります。",
    "",
    "何か困ったことがあれば、このメールに返信してください。",
    "",
    "ありがとうございます。",
    "— Ryuto",
    "",
    "────",
    "",
    enGreeting,
    "",
    "Your Steadii α access is approved. Sign in here:",
    "",
    input.inviteUrl,
    "",
    "The link includes 3 months of Pro (¥0) and starts your",
    "14-day trial on sign-in. Reply to this email if anything goes",
    "sideways.",
    "",
    "Thanks,",
    "— Ryuto",
  ].join("\n");

  // Plain HTML — keeping it minimal so Gmail's clipper doesn't shove a
  // "view entire message" footer in front of the link. Only the invite
  // URL is wrapped in an anchor; the rest is preformatted.
  const escapedUrl = escapeHtml(input.inviteUrl);
  const escapedText = escapeHtml(text).replace(
    escapeHtml(input.inviteUrl),
    `<a href="${escapedUrl}">${escapedUrl}</a>`
  );
  const html = `<pre style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin:0;">${escapedText}</pre>`;

  return {
    from: "Steadii <hello@mysteadii.xyz>",
    replyTo: "hello@mysteadii.xyz",
    subject: "Steadii: アクセスが承認されました / Your Steadii access is ready",
    text,
    html,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
