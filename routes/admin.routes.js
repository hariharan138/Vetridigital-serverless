const router = require("express").Router();
const protect = require("../middleware/auth");
const Transaction = require("../models/Transaction");

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

module.exports = router;
