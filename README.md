# SDR Jarvis

> Your AI Sales Development Rep — researches prospects, writes hyper-personalized cold emails, and books meetings. With your approval on every send.

Built for solo founders, indie hackers, and early-stage startups who want to crush outbound without burnout.

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 15 (App Router) + Tailwind CSS |
| Backend | Supabase (Postgres + Auth + pgvector) |
| Orchestration | LangGraph (stateful multi-agent with human-in-the-loop) |
| LLM | OpenAI (e.g. GPT-4o / GPT-4o-mini via API); optional xAI Grok |
| Email | Resend |
| Research | Playwright (headless browser) |
| Calendar | Google Calendar API |
| Observability | LangSmith (optional) |

## Quick Start

### 1. Clone & Install

```bash
cd sdr-jarvis
npm install
npx playwright install chromium
```

### 2. Supabase Setup

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **Project Settings → API** and copy your URL, anon key, and service role key
3. Run the migration:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

Or paste the contents of `supabase/migrations/001_initial_schema.sql` into the Supabase SQL editor.

### 3. OpenAI API Key

1. Go to [platform.openai.com](https://platform.openai.com)
2. Create an API key under **API keys**
3. Add to `.env.local` as `OPENAI_API_KEY`
4. Set `LLM_PROVIDER=openai` and `LLM_MODEL=gpt-4o-mini` (or another model your account supports)

**Optional — xAI Grok:** set `LLM_PROVIDER=xai`, `XAI_API_KEY`, and `XAI_MODEL` instead.

### 4. Resend (Email)

1. Sign up at [resend.com](https://resend.com)
2. Verify your sending domain (or use the sandbox for testing)
3. Create an API key → add as `RESEND_API_KEY`

### 5. Google Calendar (Optional for MVP)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Enable the Calendar API
3. Create OAuth 2.0 credentials (Web application)
4. Set redirect URI to `http://localhost:3000/api/auth/google/callback`
5. Add client ID and secret to `.env.local`

### 6. Configure Environment

```bash
cp .env.example .env.local
# Fill in all values
```

### 7. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Sign in with a magic link.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Next.js Frontend                     │
│  Login → Dashboard → Campaigns → Approvals → Analytics  │
└────────────────────────┬────────────────────────────────┘
                         │ API Routes
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   LangGraph Pipeline                     │
│                                                          │
│  START → Supervisor → Researcher → Outreach → [APPROVE] │
│              ↑            │            │          │       │
│              └────────────┴────────────┘          ▼       │
│                                              Send Email   │
│                                                  │       │
│                                                  ▼       │
│                                                 END      │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     Playwright     Resend    Google Calendar
     (Research)    (Email)     (Booking)
```

**Human-in-the-loop**: The graph uses `interruptBefore: ["send"]` — it pauses before any outbound send and creates an approval record. The user reviews in the dashboard, clicks Approve/Reject, and the graph resumes.

## First Test: End-to-End Flow

1. Sign in to the dashboard
2. Create a campaign via Supabase (or build the campaign creation UI next)
3. Insert 1-2 test leads via the Supabase dashboard:

```sql
INSERT INTO leads (campaign_id, user_id, first_name, last_name, email, company, title, linkedin_url)
VALUES (
  'YOUR_CAMPAIGN_ID',
  'YOUR_USER_ID',
  'Jane',
  'Doe',
  'jane@example.com',
  'Acme Corp',
  'VP Engineering',
  'https://linkedin.com/in/janedoe'
);
```

4. Trigger the pipeline via API:

```bash
curl -X POST http://localhost:3000/api/agents/run \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_AUTH_COOKIE" \
  -d '{"campaignId": "YOUR_CAMPAIGN_ID"}'
```

5. Watch the SSE stream for research → draft events
6. Check the Approvals tab in the dashboard
7. Approve or reject the draft

## Cost Optimization

| Service | Free Tier | Expected MVP Cost |
|---------|-----------|-------------------|
| Supabase | 500MB DB, 50K MAU | $0 |
| Vercel | Hobby plan | $0 (Pro: $20/mo for longer timeouts) |
| OpenAI API | Pay-per-token | ~$10-50/mo (varies by model + volume) |
| Resend | 100 emails/day | $0 |
| Google Calendar | Free | $0 |
| LangSmith | 5K traces/mo | $0 |
| **Total** | | **~$20-60/mo** |

Tips:
- Use a smaller/faster OpenAI model for high-volume steps; step up only where quality matters
- Batch lead research during off-peak hours
- Cache research results in Supabase — don't re-scrape the same lead
- Use structured JSON output to minimize token waste

## Project Structure

```
sdr-jarvis/
├── app/
│   ├── globals.css              # Jarvis dark theme
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Login (magic link)
│   ├── dashboard/
│   │   ├── layout.tsx           # Sidebar + navigation
│   │   ├── page.tsx             # Main dashboard
│   │   └── approval-actions.tsx # Approve/reject buttons
│   └── api/
│       └── agents/
│           ├── run/route.ts     # Start campaign pipeline (SSE)
│           └── approve/route.ts # Approve/reject outbound
├── lib/
│   ├── utils.ts                 # cn(), formatters, greeting
│   ├── llm.ts                   # OpenAI / optional xAI client
│   ├── supabase/
│   │   ├── client.ts            # Browser client
│   │   └── server.ts            # Server + service role client
│   └── agents/
│       ├── state.ts             # LangGraph state annotation
│       ├── jarvis-graph.ts      # Main graph + runner helpers
│       ├── nodes/
│       │   ├── supervisor.ts    # Routes tasks, manages pipeline
│       │   ├── researcher.ts    # Playwright-based lead research
│       │   └── outreach.ts      # Personalized email drafting
│       └── tools/
│           └── index.ts         # Playwright, Resend, Calendar tools
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql
├── middleware.ts                 # Auth protection
└── [config files]
```

## Next Steps (iterate from here)

- [ ] Campaign creation UI (form → Supabase insert)
- [ ] Lead import UI (CSV upload)
- [ ] Approval queue page (expanded view with edit capability)
- [ ] Qualifier agent (handle email replies, qualify interest)
- [ ] Analyst agent (campaign scoring, weekly digest)
- [ ] Jarvis chat panel (conversational interface in dashboard)
- [ ] Voice input for Jarvis chat (optional)
- [ ] LinkedIn message sending (via Playwright)
- [ ] Webhook for incoming email replies (Resend → `/api/webhooks/reply`)
- [ ] Stripe integration for billing ($49/$99 tiers)

## License

Private — all rights reserved.
