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

module.exports = mongoose.model("Transaction", transactionSchema);
