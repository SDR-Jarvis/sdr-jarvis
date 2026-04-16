import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — SDR Jarvis",
  description: "How SDR Jarvis handles your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-jarvis-dark px-6 py-16 text-jarvis-muted">
      <div className="mx-auto max-w-2xl space-y-6">
        <Link href="/" className="text-sm text-jarvis-blue hover:underline">
          ← Back
        </Link>
        <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
        <p className="text-sm leading-relaxed">
          SDR Jarvis (&quot;we&quot;, &quot;the product&quot;) is operated by you as the account
          owner. This page summarizes how the application is designed to treat data.
          It is not legal advice — consult counsel for your jurisdiction.
        </p>
        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">What we process</h2>
          <p>
            Account data (email, profile), campaign and lead records you enter or
            import, message drafts, approval history, and operational logs needed to
            run the service. Third parties you configure (e.g. Supabase, OpenAI,
            Resend) process data under their terms.
          </p>
        </section>
        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">Your responsibilities</h2>
          <p>
            You control what prospects you add and what you send. You are responsible
            for lawful basis for processing personal data of your contacts and for
            honoring opt-out requests.
          </p>
        </section>
        <section className="space-y-2 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold text-white">Retention</h2>
          <p>
            Data is retained in your Supabase project according to your project
            settings. You may delete leads, campaigns, and your account as your
            deployment allows.
          </p>
        </section>
        <p className="text-xs text-jarvis-muted/50">
          Last updated: April 2026. Contact the operator of your Jarvis deployment
          for data requests.
        </p>
      </div>
    </div>
  );
}
