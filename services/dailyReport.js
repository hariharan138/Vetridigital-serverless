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

module.exports = {
  sendDailyReport,
  buildReportData,
  generateReportPdf,
  istMonthStart,
};
