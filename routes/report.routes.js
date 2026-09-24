const router = require("express").Router();
const protect = require("../middleware/auth");
const { buildReportData, generateReportPdf } = require("../services/dailyReport");

router.use(protect);

// Download the daily report PDF directly
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
