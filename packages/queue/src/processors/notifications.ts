import { prisma } from "@dmark-hole/db";

interface NotificationJobData {
  organizationId: string;
  alertId: string;
  channels: string[];
}

export async function processNotification(data: NotificationJobData): Promise<void> {
  const { organizationId, alertId, channels } = data;

  const alert = await prisma.alert.findFirst({
    where: { id: alertId, organizationId },
  });

  if (!alert) return;

  const results: Array<{ channel: string; success: boolean; error?: string }> = [];

  for (const channel of channels) {
    try {
      switch (channel) {
        case "SLACK":
          await sendSlack(organizationId, alert.title, alert.description);
          break;
        case "DISCORD":
          await sendDiscord(organizationId, alert.title, alert.description);
          break;
        case "TEAMS":
          await sendTeams(organizationId, alert.title, alert.description);
          break;
        case "TELEGRAM":
          await sendTelegram(organizationId, alert.title, alert.description);
          break;
        case "WEBHOOK":
          await sendWebhook(organizationId, alert);
          break;
        case "EMAIL":
          await sendEmail(organizationId, alert.title, alert.description);
          break;
        case "IN_APP":
          // Already stored in DB, nothing else needed
          results.push({ channel, success: true });
          continue;
      }
      results.push({ channel, success: true });
    } catch (error) {
      results.push({
        channel,
        success: false,
        error: (error as Error).message,
      });
    }
  }

  console.log(`Notifications sent for alert ${alertId}: ${results.filter((r) => r.success).length}/${results.length} succeeded`);
}

async function sendSlack(orgId: string, title: string, description: string): Promise<void> {
  const integration = await prisma.integration.findFirst({
    where: { organizationId: orgId, type: "SLACK", active: true },
  });
  if (!integration) return;

  const config = integration.config as Record<string, unknown>;
  const webhookUrl = (config.encrypted ? process.env.SLACK_WEBHOOK_URL : (config as Record<string, string>).webhookUrl) || "";
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `*${title}*\n${description}`,
      username: "DMARK-Hole",
      icon_emoji: ":email:",
    }),
  });
}

async function sendDiscord(orgId: string, title: string, description: string): Promise<void> {
  const integration = await prisma.integration.findFirst({
    where: { organizationId: orgId, type: "DISCORD", active: true },
  });
  if (!integration) return;

  const config = integration.config as Record<string, unknown>;
  const webhookUrl = (config.encrypted ? process.env.DISCORD_WEBHOOK_URL : (config as Record<string, string>).webhookUrl) || "";
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: null,
      embeds: [
        {
          title,
          description,
          color: 0xef4444,
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
}

async function sendTeams(orgId: string, title: string, description: string): Promise<void> {
  const integration = await prisma.integration.findFirst({
    where: { organizationId: orgId, type: "TEAMS", active: true },
  });
  if (!integration) return;

  const config = integration.config as Record<string, unknown>;
  const webhookUrl = (config.encrypted ? process.env.TEAMS_WEBHOOK_URL : (config as Record<string, string>).webhookUrl) || "";
  if (!webhookUrl) return;

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: {
            type: "AdaptiveCard",
            body: [
              { type: "TextBlock", text: title, weight: "bolder", size: "medium" },
              { type: "TextBlock", text: description, wrap: true },
            ],
            $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
            version: "1.2",
          },
        },
      ],
    }),
  });
}

async function sendTelegram(orgId: string, title: string, description: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return;

  const integration = await prisma.integration.findFirst({
    where: { organizationId: orgId, type: "TELEGRAM", active: true },
  });
  if (!integration) return;

  const config = integration.config as Record<string, unknown>;
  const chatId = (config.encrypted ? "" : (config as Record<string, string>).chatId) || "";
  if (!chatId) return;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `*${title}*\n${description}`,
      parse_mode: "Markdown",
    }),
  });
}

async function sendWebhook(orgId: string, alert: Record<string, unknown>): Promise<void> {
  const integration = await prisma.integration.findFirst({
    where: { organizationId: orgId, type: "WEBHOOK", active: true },
  });
  if (!integration) return;

  const config = integration.config as Record<string, unknown>;
  const url = (config.encrypted ? "" : (config as Record<string, string>).url) || "";
  if (!url) return;

  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "alert",
      timestamp: new Date().toISOString(),
      ...alert,
    }),
  });
}

async function sendEmail(orgId: string, title: string, description: string): Promise<void> {
  // In production, use nodemailer with SMTP configuration
  console.log(`Email notification for org ${orgId}: ${title}`);
}
