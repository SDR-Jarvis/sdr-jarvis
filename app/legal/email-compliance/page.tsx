import Link from "next/link";

export const metadata = {
  title: "Cold email compliance — SDR Jarvis",
  description: "Responsible outreach and legal expectations when using SDR Jarvis.",
};

export default function EmailCompliancePage() {
  return (
    <div className="min-h-screen bg-jarvis-dark px-6 py-16 text-jarvis-muted">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/" className="text-sm text-jarvis-blue hover:underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold text-white">Cold email &amp; compliance</h1>
        <p className="text-sm leading-relaxed">
          SDR Jarvis helps you draft and queue outreach. <strong className="text-white">You</strong> are
          responsible for compliance with laws that apply to you and your recipients
          (e.g. CAN-SPAM in the US, GDPR/ePrivacy in the EU/UK, CASL in Canada, and
          others). This page is informational, not legal advice.
        </p>
        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">Legitimate interest &amp; consent</h2>
          <p>
            Only contact people where you have an appropriate lawful basis (for
            example legitimate interest in a B2B context where allowed, or consent
            where required). Do not use Jarvis to scrape logged-in networks in
            violation of those platforms&apos; terms or to send deceptive mail.
          </p>
        </section>
        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">What every email should include</h2>
          <ul className="list-inside list-disc space-y-1">
            <li>Accurate From / identity information.</li>
            <li>
              A <strong className="text-white">valid physical postal address</strong> for your
              business where required (configure in Settings → Compliance).
            </li>
            <li>
              A clear <strong className="text-white">opt-out</strong> — Jarvis appends a default
              line; customize it in Settings but do not remove opt-out language from
              sent messages.
            </li>
            <li>Honor opt-outs promptly.</li>
          </ul>
        </section>
        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">Deliverability</h2>
          <p>
            Use a dedicated sending domain, authenticate with SPF/DKIM/DMARC, warm up
            volume gradually, and keep lists clean. Jarvis includes daily processing
            and send guardrails — adjust caps in Settings as your domain matures.
          </p>
        </section>
        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">Human review</h2>
          <p>
            Drafts are queued for your approval before send. You should verify facts;
            AI can hallucinate. You remain accountable for what is sent.
          </p>
        </section>
        <p className="text-xs text-jarvis-muted/50">
          Last updated: April 2026.
        </p>
      </div>
    </div>
  );
}
