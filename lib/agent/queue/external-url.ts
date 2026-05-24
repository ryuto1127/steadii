// External-thread URL builder for queue cards.
//
// The "Open thread" link in the CardFooter should jump to the original
// email thread in the source app (Gmail web UI) so the user can see
// full context, attachments, and the rest of the conversation —
// previously it pointed back to Steadii's own draft detail page, which
// was redundant with the main card-body click.
//
// Outlook is intentionally null at α: Mail.Read scope is deferred per
// `project_ms_graph_scope` memory (school tenants require admin
// consent), so outlook drafts have no thread context to deep-link to
// today. When MS Mail.Read lands, add the outlook branch here.

const GMAIL_THREAD_BASE = "https://mail.google.com/mail/u/0/#inbox/";

export function buildExternalThreadUrl(
  sourceType: string | null | undefined,
  threadExternalId: string | null | undefined
): string | null {
  if (!sourceType || !threadExternalId) return null;
  if (sourceType === "gmail") {
    return `${GMAIL_THREAD_BASE}${threadExternalId}`;
  }
  // outlook → deferred until Mail.Read scope lands.
  // unknown source_type → don't guess.
  return null;
}
