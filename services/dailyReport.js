const crypto = require("crypto");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");
const Transaction = require("../models/Transaction");

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Start/end of "today" in IST, expressed as UTC dates for Mongo queries
function istDayRange(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const start = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MS
  );
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// Start of the current IST month, as a UTC date
function istMonthStart(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS);
}

function istMonthLabel(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function istDateLabel(now = new Date()) {
  return new Date(now.getTime() + IST_OFFSET_MS).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

const fmt = (n) => `Rs. ${(n || 0).toLocaleString("en-IN")}`;

const STATUS_LABELS = {
  completed: "Completed",
  pending: "Pending",
  partially_paid: "Partially Paid",
};

async function buildReportData(now = new Date()) {
  const { start, end } = istDayRange(now);
  const all = await Transaction.find().populate("user", "name").lean();

  const sum = (list, fn) => list.reduce((s, t) => s + (fn(t) || 0), 0);
  const today = all.filter((t) => t.date >= start && t.date < end);
  const monthStart = istMonthStart(now);
  const month = all.filter((t) => t.date >= monthStart && t.date < end);
  const upToToday = all.filter((t) => t.date < end);
  const net = (list) =>
    sum(list, (t) => (t.type === "income" ? t.amount : t.type === "expense" ? -t.amount : 0));

  const pendingOrders = all.filter(
    (t) => t.isPendingOrder && (t.status === "pending" || t.status === "partially_paid")
  );

  const paymentSplit = {};
  all.forEach((t) => {
    const m = t.paymentMethod || "Cash";
    paymentSplit[m] = (paymentSplit[m] || 0) + t.amount;
  });

  return {
    dateLabel: istDateLabel(now),
    today: {
      income: sum(today.filter((t) => t.type === "income"), (t) => t.amount),
      expense: sum(today.filter((t) => t.type === "expense"), (t) => t.amount),
      count: today.length,
      newOrders: today.filter((t) => t.isPendingOrder).length,
      transactions: today,
    },
    month: {
      label: istMonthLabel(now),
      income: sum(month.filter((t) => t.type === "income"), (t) => t.amount),
      expense: sum(month.filter((t) => t.type === "expense"), (t) => t.amount),
    },
    // Running balance (cumulative net) up to end of today, same as the dashboard chart
    balance: net(upToToday),
    overall: {
      income: sum(all.filter((t) => t.type === "income"), (t) => t.amount),
      expense: sum(all.filter((t) => t.type === "expense"), (t) => t.amount),
      totalOrders: all.filter((t) => t.isPendingOrder).length,
      openOrders: pendingOrders.length,
      advanceCollected: sum(pendingOrders, (t) => t.advanceAmount),
      pendingReceivables: sum(pendingOrders, (t) => t.pendingAmount),
    },
    pendingOrders,
    paymentSplit,
  };
}

function generateReportPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageWidth = doc.page.width - 80;

    const heading = (text) => {
      if (doc.y > 700) doc.addPage();
      doc.moveDown(1);
      doc.fontSize(13).font("Helvetica-Bold").fillColor("#7c3aed").text(text);
      doc.moveTo(40, doc.y + 2).lineTo(40 + pageWidth, doc.y + 2).strokeColor("#e5e5ef").stroke();
      doc.moveDown(0.5);
      doc.fillColor("#111111");
    };

    const kvRow = (label, value) => {
      doc.fontSize(10).font("Helvetica").fillColor("#555555").text(label, 40, doc.y, {
        continued: true,
        width: pageWidth,
      });
      doc.font("Helvetica-Bold").fillColor("#111111").text(value, { align: "right" });
      doc.moveDown(0.25);
    };

    const tableRow = (cols, widths, opts = {}) => {
      if (doc.y > 760) doc.addPage();
      const y = doc.y;
      let x = 40;
      doc
        .fontSize(9)
        .font(opts.bold ? "Helvetica-Bold" : "Helvetica")
        .fillColor(opts.color || "#111111");
      cols.forEach((col, i) => {
        doc.text(String(col), x, y, { width: widths[i] - 6, lineBreak: false });
        x += widths[i];
      });
      doc.y = y + 16;
      doc.x = 40;
    };

    // Header
    doc.fontSize(20).font("Helvetica-Bold").fillColor("#111111").text("Vetri Digitals");
    doc.fontSize(11).font("Helvetica").fillColor("#555555").text(`Daily Business Report — ${data.dateLabel}`);

    heading("Today's Summary");
    kvRow("Income today", fmt(data.today.income));
    kvRow("Expense today", fmt(data.today.expense));
    kvRow("Net (today)", fmt(data.today.income - data.today.expense));
    kvRow("Transactions today", String(data.today.count));
    kvRow("New orders today", String(data.today.newOrders));

    heading("Overall Summary");
    kvRow("Total income", fmt(data.overall.income));
    kvRow("Total expense", fmt(data.overall.expense));
    kvRow("Net balance", fmt(data.overall.income - data.overall.expense));
    kvRow("Total orders (all time)", String(data.overall.totalOrders));
    kvRow("Open pending orders", String(data.overall.openOrders));
    kvRow("Advance collected (open orders)", fmt(data.overall.advanceCollected));
    kvRow("Pending receivables", fmt(data.overall.pendingReceivables));

    heading("Payment Methods (overall)");
    Object.entries(data.paymentSplit).forEach(([method, amount]) => kvRow(method, fmt(amount)));

    heading(`Pending Orders (${data.pendingOrders.length})`);
    if (data.pendingOrders.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor("#555555").text("No open pending orders.");
    } else {
      const w = [70, 165, 75, 75, 75, 70];
      tableRow(["Date", "Remark", "Total", "Advance", "Pending", "Status"], w, {
        bold: true,
        color: "#555555",
      });
      data.pendingOrders.forEach((o) => {
        tableRow(
          [
            new Date(o.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
            (o.remark || "").slice(0, 40),
            fmt(o.totalOrderAmount),
            fmt(o.advanceAmount),
            fmt(o.pendingAmount),
            STATUS_LABELS[o.status] || o.status,
          ],
          w
        );
      });
    }

    heading(`Today's Transactions (${data.today.transactions.length})`);
    if (data.today.transactions.length === 0) {
      doc.fontSize(10).font("Helvetica").fillColor("#555555").text("No transactions recorded today.");
    } else {
      const w = [65, 60, 165, 60, 90, 75];
      tableRow(["Date", "Type", "Remark", "Method", "Amount", "Status"], w, {
        bold: true,
        color: "#555555",
      });
      data.today.transactions.forEach((t) => {
        tableRow(
          [
            new Date(t.date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }),
            t.type,
            (t.remark || "").slice(0, 40),
            t.paymentMethod || "Cash",
            `${t.type === "income" ? "+" : "-"}${fmt(t.amount)}`,
            STATUS_LABELS[t.status] || "Completed",
          ],
          w
        );
      });
    }

    doc.moveDown(1.5);
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#999999")
      .text(
        `Generated automatically at ${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST`,
        40
      );

    doc.end();
  });
}

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SERVICE } = process.env;
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (SMTP_SERVICE) {
    return nodemailer.createTransport({
      service: SMTP_SERVICE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function sendDailyReport() {
  const recipients = (process.env.REPORT_EMAILS || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    console.warn("[daily-report] REPORT_EMAILS not set — skipping report");
    return { sent: false, reason: "REPORT_EMAILS not configured" };
  }

  const transporter = getTransporter();
  if (!transporter) {
    console.warn("[daily-report] SMTP credentials not set — skipping report");
    return { sent: false, reason: "SMTP not configured" };
  }

  const data = await buildReportData();
  const pdf = await generateReportPdf(data);
  const net = data.today.income - data.today.expense;

  await transporter.sendMail({
    from: `"Vetri Digitals Reports" <${process.env.SMTP_USER}>`,
    to: recipients.join(", "),
    subject: `Daily Report ${data.dateLabel} — Income ${fmt(data.today.income)}, Expense ${fmt(data.today.expense)}`,
    text: [
      `Daily business report for ${data.dateLabel}`,
      ``,
      `Today: income ${fmt(data.today.income)}, expense ${fmt(data.today.expense)}, net ${fmt(net)}`,
      `Open pending orders: ${data.overall.openOrders} (receivables ${fmt(data.overall.pendingReceivables)})`,
      ``,
      `Full details are in the attached PDF.`,
    ].join("\n"),
    attachments: [
      {
        filename: `vetri-daily-report-${data.dateLabel.replace(/ /g, "-")}.pdf`,
        content: pdf,
        contentType: "application/pdf",
      },
    ],
  });

  console.log(`[daily-report] Sent to ${recipients.join(", ")}`);
  return { sent: true, recipients };
}

const inr = (n) => `${n < 0 ? "-" : ""}₹${Math.abs(n || 0).toLocaleString("en-IN")}`;

function telegramMessage(data, dayLabel = "Today") {
  const { today, month, balance } = data;
  return [
    `<b>📊 Daily Report — ${data.dateLabel}</b>`,
    ``,
    `<b>${dayLabel}</b>`,
    `Income: ${inr(today.income)}`,
    `Expense: ${inr(today.expense)}`,
    `Day Net: ${inr(today.income - today.expense)}`,
    `Balance: ${inr(balance)}`,
    ``,
    `<b>${month.label} (up to ${data.dateLabel})</b>`,
    `Income: ${inr(month.income)}`,
    `Expense: ${inr(month.expense)}`,
    `Month Net: ${inr(month.income - month.expense)}`,
    `Month Balance: ${inr(balance)}`,
  ].join("\n");
}

const telegramApi = (method) =>
  `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

const telegramChatIds = () =>
  (process.env.TELEGRAM_CHAT_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

// Telegram caps a message at 4096 chars, so long text goes out in parts split on
// line breaks (our HTML tags never span lines). Returns the first failed response, else the last.
async function telegramSend(chat_id, text) {
  const parts = [""];
  for (const line of text.split("\n")) {
    if (parts.at(-1).length + line.length + 1 > 4000) parts.push("");
    parts[parts.length - 1] += (parts.at(-1) ? "\n" : "") + line;
  }
  let res;
  for (const part of parts) {
    res = await fetch(telegramApi("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text: part, parse_mode: "HTML" }),
    });
    if (!res.ok) break;
  }
  return res;
}

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const TELEGRAM_HELP = [
  `Send:`,
  `• <b>report</b> — today's report`,
  `• <b>yesterday report</b> — yesterday's report`,
  `• any word from a remark, e.g. <b>Seenu paid</b> — list matching transactions`,
].join("\n");

// The 9 PM IST report has already gone out once the IST hour reaches 21
function nextReportText(now = new Date()) {
  const istHour = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();
  return `Your report will come ${istHour >= 21 ? "tomorrow" : "today"} at 9 PM.`;
}

// All transactions whose remark contains every word of the query (any order, any case)
async function searchRemarks(query) {
  const words = query.split(" ").map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const list = await Transaction.find({
    $and: words.map((w) => ({ remark: { $regex: w, $options: "i" } })),
  })
    .sort({ date: -1 })
    .lean();

  if (list.length === 0) {
    return `No transactions found for "${escapeHtml(query)}".\n\n${TELEGRAM_HELP}`;
  }

  const total = (type) => list.filter((t) => t.type === type).reduce((s, t) => s + t.amount, 0);
  const date = (d) =>
    new Date(d).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Kolkata",
    });

  return [
    `<b>🔍 "${escapeHtml(query)}" — ${list.length} transaction(s)</b>`,
    `Total income: ${inr(total("income"))}`,
    `Total expense: ${inr(total("expense"))}`,
    ``,
    ...list.map(
      (t) => `${date(t.date)} · ${t.type === "income" ? "+" : "-"}${inr(t.amount)} · ${escapeHtml(t.remark)}`
    ),
  ].join("\n");
}

// Reply text for an incoming message
async function telegramReply(msg) {
  const chatId = String(msg.chat.id);
  // Only listed chats may see business numbers; tell others their ID so an admin can add them
  if (!telegramChatIds().includes(chatId)) {
    return `You are not authorised to use this bot. Your chat ID: ${chatId}`;
  }

  // "/report@vetri_reports_bot" → "report"
  const query = msg.text.trim().replace(/^\//, "").replace(/@\w+bot$/i, "").replace(/\s+/g, " ");
  const cmd = query.toLowerCase();

  if (cmd === "report") return telegramMessage(await buildReportData());
  if (cmd === "yesterday report" || cmd === "yesterday") {
    return telegramMessage(await buildReportData(new Date(Date.now() - 24 * 60 * 60 * 1000)), "Yesterday");
  }
  if (!cmd || ["hi", "hello", "hey", "start", "help"].includes(cmd)) {
    return `${nextReportText()}\n\n${TELEGRAM_HELP}`;
  }
  return searchRemarks(query);
}

// ponytail: long polling, needs exactly one running server per bot token.
// Switch to setWebhook if the host sleeps or runs multiple instances.
// Telegram echoes this in a header on every webhook call, proving the request is really from Telegram.
// Derived from the bot token so there is nothing extra to configure.
const telegramWebhookSecret = () =>
  crypto.createHash("sha256").update(process.env.TELEGRAM_BOT_TOKEN).digest("hex");

// Registers this deployment's public URL with Telegram. Only one URL can be registered per bot,
// so there are never two deployments fighting over messages (unlike getUpdates polling).
// Vercel sets VERCEL_URL automatically (host only, no scheme); PUBLIC_URL overrides it for a
// custom domain. Neither is set locally, so local runs stay out of the way.
async function setTelegramWebhook() {
  const baseUrl =
    process.env.PUBLIC_URL || (process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`);
  if (!process.env.TELEGRAM_BOT_TOKEN || !baseUrl) {
    console.log("[telegram-bot] No public URL — not receiving bot messages on this server");
    return;
  }
  const res = await fetch(telegramApi("setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: `${baseUrl}/api/telegram/webhook`,
      secret_token: telegramWebhookSecret(),
      allowed_updates: ["message"],
    }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(body.description);
  console.log(`[telegram-bot] Receiving messages at ${baseUrl}/api/telegram/webhook`);
}

function handleTelegramWebhook(req, res) {
  if (
    !process.env.TELEGRAM_BOT_TOKEN ||
    req.get("X-Telegram-Bot-Api-Secret-Token") !== telegramWebhookSecret()
  ) {
    return res.sendStatus(401);
  }
  // Answer Telegram right away; a slow reply would make it resend the same message
  res.sendStatus(200);

  const msg = req.body?.message;
  if (!msg?.text) return;
  console.log(`[telegram-bot] ${msg.chat.id}: ${msg.text}`);
  telegramReply(msg)
    .then((text) => telegramSend(msg.chat.id, text))
    .then(async (r) => {
      if (!r.ok) console.error("[telegram-bot] reply failed:", (await r.json()).description);
    })
    .catch((err) => console.error("[telegram-bot] reply failed:", err.message));
}

async function sendTelegramReport() {
  const chatIds = telegramChatIds();

  if (!process.env.TELEGRAM_BOT_TOKEN || chatIds.length === 0) {
    console.warn("[telegram-report] TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_IDS not set — skipping");
    return { sent: false, reason: "Telegram not configured" };
  }

  const text = telegramMessage(await buildReportData());
  const failed = [];
  for (const chat_id of chatIds) {
    const res = await telegramSend(chat_id, text);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error(`[telegram-report] chat ${chat_id} failed: ${body.description || res.status}`);
      failed.push(chat_id);
    }
  }

  if (failed.length === chatIds.length) {
    return { sent: false, reason: `Telegram send failed for ${failed.join(", ")}` };
  }
  console.log(`[telegram-report] Sent to ${chatIds.length - failed.length} chat(s)`);
  return { sent: true, chatIds, failed };
}

module.exports = {
  sendDailyReport,
  sendTelegramReport,
  setTelegramWebhook,
  handleTelegramWebhook,
  telegramSend,
  telegramReply,
  nextReportText,
  telegramMessage,
  buildReportData,
  generateReportPdf,
  istMonthStart,
};
