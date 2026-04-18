import { logger } from "@/lib/logger";

/**
 * Slack incoming webhook — never throws; failures are logged only.
 */
export async function sendSlackNotification(message: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL?.trim();
  if (!url) {
    logger.info("slack", "Slack not configured (SLACK_WEBHOOK_URL empty)");
    return;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message }),
    });
    if (!res.ok) {
      logger.error("slack", `Slack webhook failed: ${res.status} ${res.statusText}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("slack", `Slack request error: ${msg}`);
  }
}
