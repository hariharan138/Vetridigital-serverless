const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["income", "expense"], required: true },
    amount: { type: Number, required: true },
    remark: { type: String, required: true },
    date: { type: Date, default: Date.now },
    paymentMethod: {
      type: String,
      enum: ["Cash", "UPI"],
      default: "Cash",
    },
    shared: { type: Boolean, default: false },
    isPendingOrder: { type: Boolean, default: false },
    totalOrderAmount: { type: Number },
    advanceAmount: { type: Number },
    pendingAmount: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["completed", "pending", "partially_paid", "unconfirmed"],
      default: "completed",
    },
  },
  { timestamps: true }
);

// Matches the .find(filter).sort({ date: -1, createdAt: -1 }) pattern used
// by every transaction/report query — without it, Mongo does a full
// collection scan and in-memory sort on every request as data grows.
transactionSchema.index({ date: -1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
