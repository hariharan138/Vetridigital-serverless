const router = require("express").Router();
const protect = require("../middleware/auth");
const Transaction = require("../models/Transaction");
const { setTelegramWebhook } = require("../services/dailyReport");

router.use(protect);

// One-off backfill for transactions saved before `paymentMethod` existed.
// The old always-on server ran this at boot; a serverless function has no
// boot step, so it's now a manual admin action instead of running on every
// cold start.
router.post("/migrate-payment-method", async (_req, res) => {
  try {
    const result = await Transaction.updateMany(
      { paymentMethod: { $exists: false } },
      { $set: { paymentMethod: "Cash" } }
    );
    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Registers this deployment's URL with Telegram as the bot's webhook.
// Run once after each new deployment URL (set PUBLIC_URL to it first) —
// the old server did this automatically at boot, which doesn't apply here.
router.post("/telegram/set-webhook", async (_req, res) => {
  try {
    await setTelegramWebhook();
    res.json({ message: "Telegram webhook registered" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
