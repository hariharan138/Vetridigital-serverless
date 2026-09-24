const NotebookNote = require("../models/NotebookNote");
const NotebookFolder = require("../models/NotebookFolder");

const MAX_VERSIONS = 20;

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function listFilter(_userId, view) {
  // Shared across all users — `user` is author only
  const base = {};
  switch (view) {
    case "pinned":
      return { ...base, deleted: false, archived: false, pinned: true };
    case "favorites":
      return { ...base, deleted: false, archived: false, favorite: true };
    case "archived":
      return { ...base, deleted: false, archived: true };
    case "trash":
      return { ...base, deleted: true };
    case "all":
    default:
      return { ...base, deleted: false, archived: false };
  }
}

function sortSpec(sort) {
  if (sort === "created") return { createdAt: -1 };
  if (sort === "alpha") return { title: 1 };
  return { updatedAt: -1 };
}

exports.getMeta = async (req, res) => {
  try {
    const folders = await NotebookFolder.find({}).sort({ name: 1 });

    const [all, pinned, favorites, archived, trash] = await Promise.all([
      NotebookNote.countDocuments({ deleted: false, archived: false }),
      NotebookNote.countDocuments({ deleted: false, archived: false, pinned: true }),
      NotebookNote.countDocuments({ deleted: false, archived: false, favorite: true }),
      NotebookNote.countDocuments({ deleted: false, archived: true }),
      NotebookNote.countDocuments({ deleted: true }),
    ]);

    const folderCounts = {};
    for (const f of folders) {
      folderCounts[String(f._id)] = await NotebookNote.countDocuments({
        folder: f._id,
        deleted: false,
        archived: false,
      });
    }

    const tagAgg = await NotebookNote.aggregate([
      { $match: { deleted: false } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
    ]);

    const recent = await NotebookNote.find({ deleted: false, archived: false })
      .sort({ updatedAt: -1 })
      .limit(8)
      .select("title updatedAt pinned favorite colorLabel")
      .populate("user", "name");

    res.json({
      folders,
      counts: { all, pinned, favorites, archived, trash, folders: folderCounts },
      tags: tagAgg.map((t) => ({ name: t._id, count: t.count })),
      recent,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.listNotes = async (req, res) => {
  try {
    const {
      view = "all",
      folder,
      tag,
      q,
      sort = "updated",
      skip = "0",
      limit = "40",
    } = req.query;

    const filter = listFilter(req.user.id, view);
    if (folder) filter.folder = folder;
    if (tag) filter.tags = tag;
    if (q && String(q).trim()) {
      const re = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { title: re },
        { plainText: re },
        { tags: re },
      ];
    }

    const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 40));
    const sk = Math.max(0, parseInt(skip, 10) || 0);

    const [notes, total] = await Promise.all([
      NotebookNote.find(filter)
        .sort(sortSpec(sort))
        .skip(sk)
        .limit(lim)
        .select("-versions -attachments")
        .populate("folder", "name color")
        .populate("user", "name email"),
      NotebookNote.countDocuments(filter),
    ]);

    const items = notes.map((n) => {
      const o = n.toObject();
      o.preview = stripHtml(o.content || o.plainText).slice(0, 180);
      return o;
    });

    res.json({ notes: items, total, hasMore: sk + items.length < total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const note = await NotebookNote.findById(req.params.id)
      .select("-attachments")
      .populate("folder", "name color")
      .populate("user", "name email");
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { title, content, folder, tags, colorLabel } = req.body;
    const html = content != null ? String(content) : "";
    const note = await NotebookNote.create({
      user: req.user.id,
      title: (title && String(title).trim()) || "Untitled",
      content: html,
      plainText: stripHtml(html),
      folder: folder || null,
      tags: Array.isArray(tags) ? tags.map(String) : [],
      colorLabel: colorLabel || "",
    });
    res.status(201).json(note);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const note = await NotebookNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: "Note not found" });
    if (note.deleted) return res.status(400).json({ message: "Restore note before editing" });

    const fields = [
      "title",
      "content",
      "folder",
      "tags",
      "pinned",
      "favorite",
      "archived",
      "locked",
      "colorLabel",
      "reminder",
    ];

    const contentChanging =
      req.body.content !== undefined && req.body.content !== note.content;
    const titleChanging = req.body.title !== undefined && req.body.title !== note.title;

    // Snapshot at most once every 2 minutes to avoid version spam from autosave
    const lastSnap = note.versions?.[0]?.savedAt
      ? new Date(note.versions[0].savedAt).getTime()
      : 0;
    const canSnapshot = Date.now() - lastSnap > 2 * 60 * 1000;
    if ((contentChanging || titleChanging) && canSnapshot) {
      note.versions.unshift({
        title: note.title,
        content: note.content,
        savedAt: new Date(),
      });
      if (note.versions.length > MAX_VERSIONS) note.versions = note.versions.slice(0, MAX_VERSIONS);
    }

    for (const key of fields) {
      if (req.body[key] === undefined) continue;
      if (key === "title") note.title = String(req.body.title).trim() || "Untitled";
      else if (key === "content") {
        note.content = String(req.body.content);
        note.plainText = stripHtml(note.content);
      } else if (key === "tags") {
        note.tags = Array.isArray(req.body.tags)
          ? [...new Set(req.body.tags.map((t) => String(t).trim()).filter(Boolean))]
          : [];
      } else if (key === "folder") {
        note.folder = req.body.folder || null;
      } else if (key === "reminder") {
        note.reminder = req.body.reminder || null;
      } else {
        note[key] = req.body[key];
      }
    }

    await note.save();
    await note.populate([
      { path: "folder", select: "name color" },
      { path: "user", select: "name email" },
    ]);
    const out = note.toObject();
    delete out.attachments;
    res.json(out);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.softDelete = async (req, res) => {
  try {
    const note = await NotebookNote.findOneAndUpdate(
      { _id: req.params.id },
      { deleted: true, deletedAt: new Date(), pinned: false },
      { new: true }
    );
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.restore = async (req, res) => {
  try {
    const note = await NotebookNote.findOneAndUpdate(
      { _id: req.params.id, deleted: true },
      { deleted: false, deletedAt: null },
      { new: true }
    );
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.permanentDelete = async (req, res) => {
  try {
    const note = await NotebookNote.findOneAndDelete({
      _id: req.params.id,
      deleted: true,
    });
    if (!note) return res.status(404).json({ message: "Note not found in trash" });
    res.json({ message: "Permanently deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.duplicate = async (req, res) => {
  try {
    const src = await NotebookNote.findById(req.params.id);
    if (!src) return res.status(404).json({ message: "Note not found" });
    const copy = await NotebookNote.create({
      user: req.user.id,
      title: `${src.title} (Copy)`,
      content: src.content,
      plainText: src.plainText,
      folder: src.folder,
      tags: src.tags,
      colorLabel: src.colorLabel,
    });
    res.status(201).json(copy);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.restoreVersion = async (req, res) => {
  try {
    const note = await NotebookNote.findById(req.params.id);
    if (!note) return res.status(404).json({ message: "Note not found" });
    const ver = note.versions.id(req.params.versionId);
    if (!ver) return res.status(404).json({ message: "Version not found" });

    note.versions.unshift({
      title: note.title,
      content: note.content,
      savedAt: new Date(),
    });
    note.title = ver.title;
    note.content = ver.content;
    note.plainText = stripHtml(ver.content);
    if (note.versions.length > MAX_VERSIONS) note.versions = note.versions.slice(0, MAX_VERSIONS);
    await note.save();
    await note.populate([
      { path: "folder", select: "name color" },
      { path: "user", select: "name email" },
    ]);
    const out = note.toObject();
    delete out.attachments;
    res.json(out);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.createFolder = async (req, res) => {
  try {
    const { name, parent, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: "Folder name required" });
    const folder = await NotebookFolder.create({
      user: req.user.id,
      name: String(name).trim(),
      parent: parent || null,
      color: color || "",
    });
    res.status(201).json(folder);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.updateFolder = async (req, res) => {
  try {
    const updates = {};
    if (req.body.name != null) updates.name = String(req.body.name).trim();
    if (req.body.parent !== undefined) updates.parent = req.body.parent || null;
    if (req.body.color !== undefined) updates.color = req.body.color || "";
    const folder = await NotebookFolder.findOneAndUpdate(
      { _id: req.params.id },
      updates,
      { new: true }
    );
    if (!folder) return res.status(404).json({ message: "Folder not found" });
    res.json(folder);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.deleteFolder = async (req, res) => {
  try {
    const folder = await NotebookFolder.findOneAndDelete({
      _id: req.params.id,
    });
    if (!folder) return res.status(404).json({ message: "Folder not found" });
    await NotebookNote.updateMany({ folder: folder._id }, { folder: null });
    await NotebookFolder.updateMany({ parent: folder._id }, { parent: null });
    res.json({ message: "Folder deleted" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
