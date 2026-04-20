export const dynamic = "force-static";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        α — subject to change
      </p>
      <h1 className="mt-6 font-serif text-4xl">Terms of Service</h1>
      <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
        Last updated: 2026-04-20
      </p>

      <div className="mt-10 space-y-6 text-sm leading-relaxed">
        <Section
          heading="Alpha status"
          body={`Steadii is in invite-only α. The product is provided as-is, may be changed or withdrawn at any time, and is not warranted fit for any particular purpose. Billing runs in Stripe test mode during α — no real charges post.`}
        />
        <Section
          heading="Acceptable use"
          body={`Don't use Steadii to commit academic fraud. The agent is a study aid — it reasons, explains, and organizes. Submitting machine output as your own work on a graded assignment is your responsibility and may violate your institution's policies.`}
        />
        <Section
          heading="Your content"
          body={`You retain ownership of everything you put into Steadii — Notion pages, attachments, syllabi, chat messages. You grant us a limited license to process this content solely to operate the service for you.`}
        />
        <Section
          heading="External services"
          body={`Steadii connects to Notion, Google Calendar, OpenAI, Vercel Blob, and Stripe. By using Steadii you also accept those services' terms. If any of them become unavailable, parts of Steadii will degrade gracefully.`}
        />
        <Section
          heading="Plan limits"
          body={`Free plan: 250 credits/month, 5 MB per file, 200 MB total storage. Pro: 1,000 credits/month, 50 MB per file, 2 GB total storage. A credit is approximately $0.01 worth of model usage. Limits are subject to change with notice.`}
        />
        <Section
          heading="Termination"
          body={`You can stop using Steadii at any time. We can revoke access if you violate these terms. On termination, your data is deleted per the Privacy Policy.`}
        />
        <Section
          heading="Liability"
          body={`To the maximum extent permitted by law, Steadii is not liable for indirect, consequential, or incidental damages arising from use of the service, including missed deadlines or incorrect answers.`}
        />
        <Section
          heading="Contact"
          body={`Questions or deletion requests: email the administrator at the address shown in your onboarding email.`}
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
