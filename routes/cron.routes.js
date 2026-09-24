const router = require("express").Router();
const { sendDailyReport } = require("../services/dailyReport");

// Replaces the node-cron job from the old always-on server. Vercel Cron Jobs
// hits this route on a schedule (see vercel.json `crons`). Vercel injects
// `Authorization: Bearer $CRON_SECRET` on its own invocations when CRON_SECRET
// is set as a project env var, so we verify it to stop anyone else calling this.
router.get("/daily-report", async (req, res) => {
  if (process.env.CRON_SECRET) {
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ message: "Unauthorized" });
    }
  }

  try {
    const email = await sendDailyReport();
    res.json({ email });
  } catch (err) {
    console.error("[cron] daily-report failed:", err);
    res.status(500).json({ message: err.message || "Daily report failed" });
  }
});

module.exports = router;
