const mongoose = require("mongoose");

const folderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    parent: { type: mongoose.Schema.Types.ObjectId, ref: "NotebookFolder", default: null },
    color: { type: String, default: "" },
  },
  { timestamps: true }
);

folderSchema.index({ user: 1, parent: 1 });

module.exports = mongoose.model("NotebookFolder", folderSchema);
