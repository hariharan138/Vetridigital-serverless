const mongoose = require("mongoose");

const attachmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    mime: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    data: { type: String, required: true }, // data URL / base64
  },
  { _id: true, timestamps: true }
);

const versionSchema = new mongoose.Schema(
  {
    title: String,
    content: String,
    savedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const reminderSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    recur: {
      type: String,
      enum: ["none", "daily", "weekly", "monthly"],
      default: "none",
    },
    label: { type: String, default: "" },
  },
  { _id: false }
);

const notebookNoteSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, default: "Untitled", trim: true },
    content: { type: String, default: "" }, // HTML
    plainText: { type: String, default: "" }, // for search
    folder: { type: mongoose.Schema.Types.ObjectId, ref: "NotebookFolder", default: null },
    tags: [{ type: String, trim: true }],
    attachments: { type: [attachmentSchema], default: [] },
    pinned: { type: Boolean, default: false },
    favorite: { type: Boolean, default: false },
    archived: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    locked: { type: Boolean, default: false },
    colorLabel: {
      type: String,
      enum: ["", "yellow", "green", "blue", "purple", "pink", "orange"],
      default: "",
    },
    reminder: { type: reminderSchema, default: null },
    versions: { type: [versionSchema], default: [] },
  },
  { timestamps: true }
);

notebookNoteSchema.index({ user: 1, updatedAt: -1 });
notebookNoteSchema.index({ user: 1, deleted: 1, archived: 1 });

module.exports = mongoose.model("NotebookNote", notebookNoteSchema);
