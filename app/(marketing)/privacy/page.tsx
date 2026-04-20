export const dynamic = "force-static";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        α — subject to change
      </p>
      <h1 className="mt-6 font-serif text-4xl">Privacy Policy</h1>
      <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
        Last updated: 2026-04-20
      </p>

      <div className="mt-10 space-y-6 text-sm leading-relaxed">
        <Section
          heading="What we collect"
          body={`Steadii stores your Google profile (name, email, avatar), OAuth tokens for Notion and Google Calendar (AES-256-GCM encrypted at the application layer), your chat history, and the files you upload (syllabi and chat attachments). We do not collect device fingerprints or tracking cookies.`}
        />
        <Section
          heading="How we use it"
          body={`Your data is used to (1) operate the product — answer chat messages, read and write Notion, read Google Calendar, (2) enforce the plan limits (credits, storage), and (3) log errors for debugging. OpenAI requests include only the minimum context needed to answer the question.`}
        />
        <Section
          heading="Model training"
          body={`OpenAI's API does not train on your data by default, and Steadii does not enable training. Anthropic/third-party model providers are not used.`}
        />
        <Section
          heading="Third parties"
          body={`Vercel (hosting, edge cache, blob storage), Neon (Postgres), OpenAI (inference), Notion (your workspace), Google (auth + calendar), Stripe (billing, test mode during α), Sentry (error tracking, with PII scrubbing on).`}
        />
        <Section
          heading="Data location"
          body={`Vercel and Neon both operate primarily in US regions during α. If you need EU-resident data storage, email the administrator before signing up.`}
        />
        <Section
          heading="Retention and deletion"
          body={`You can delete your account at any time by emailing the administrator. On deletion, we remove rows from users, accounts, notion_connections, chats, messages, message_attachments, blob_assets (including the underlying Vercel Blob objects), registered_resources, audit_log, and usage_events within 30 days.`}
        />
        <Section
          heading="Your rights"
          body={`You can request a copy of your data, corrections, or deletion at any time. Contact the administrator via the email you used to sign up.`}
        />
        <Section
          heading="α caveat"
          body={`This is the α version, running in invite-only mode with Stripe in test mode. Legal language here is a working draft and will be replaced before a β or public launch. We will notify you of material changes via the email you signed up with.`}
        />
      </div>
    </main>
  );
}

function Section({ heading, body }: { heading: string; body: string }) {
  return (
    <section>
      <h2 className="font-serif text-xl">{heading}</h2>
      <p className="mt-2 text-[hsl(var(--foreground))]">{body}</p>
    </section>
  );
}
