const mongoose = require("mongoose");

// Singleton document — shared cash overview values, not per-user
const cashOverviewSchema = new mongoose.Schema(
  {
    totalExpenseOverride: { type: Number, default: null },
    inHand: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CashOverview", cashOverviewSchema);
