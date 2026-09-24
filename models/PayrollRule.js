const mongoose = require("mongoose");

const overrideSchema = new mongoose.Schema(
  {
    dueDate: { type: Date, required: true },
    action: {
      type: String,
      enum: ["mark_paid", "ignore", "link", "adjust", "note"],
      required: true,
    },
    expectedAmount: { type: Number },
    linkedTransaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction" },
    notes: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const payrollRuleSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    employeeName: { type: String, required: true, trim: true },
    remark: { type: String, required: true, trim: true },
    startDate: { type: Date, required: true },
    expectedAmount: { type: Number, required: true, min: 0 },
    frequencyType: {
      type: String,
      enum: ["days", "weekly", "monthly", "custom"],
      required: true,
    },
    frequencyValue: { type: Number, default: 7, min: 1 },
    reminderDays: { type: Number, enum: [1, 2, 3], default: 1 },
    active: { type: Boolean, default: true },
    overrides: { type: [overrideSchema], default: [] },
  },
  { timestamps: true }
);

payrollRuleSchema.index({ user: 1, employeeName: 1 });

module.exports = mongoose.model("PayrollRule", payrollRuleSchema);
