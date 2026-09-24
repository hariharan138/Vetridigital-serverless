const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, required: true },
    text: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

noteSchema.index({ user: 1, date: 1 });

module.exports = mongoose.model("Note", noteSchema);
