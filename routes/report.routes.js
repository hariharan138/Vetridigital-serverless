const router = require("express").Router();
const protect = require("../middleware/auth");
const { sendDailyReport, buildReportData, generateReportPdf } = require("../services/dailyReport");

router.use(protect);

// Manually trigger the daily report email (for testing / resend)
router.post("/send-daily", async (_req, res) => {
  try {
    const result = await sendDailyReport();
    if (!result.sent) return res.status(400).json({ message: result.reason });
    res.json({ message: `Report sent to ${result.recipients.join(", ")}` });
  } catch (err) {
    console.error("[daily-report] send failed:", err);
    res.status(500).json({ message: err.message || "Failed to send report" });
  }
});

// Download the daily report PDF directly (no email involved)
router.get("/daily.pdf", async (_req, res) => {
  try {
    const data = await buildReportData();
    const pdf = await generateReportPdf(data);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="vetri-daily-report.pdf"`,
    });
    res.send(pdf);
  } catch (err) {
    console.error("[daily-report] pdf failed:", err);
    res.status(500).json({ message: err.message || "Failed to generate report" });
  }
});

module.exports = router;
