const Note = require("../models/Note");

function dayStart(dateStr) {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return d;
}

// Shared team notes — visible to all authenticated users
// GET /notes?year=2026  or  ?date=yyyy-MM-dd
exports.getAll = async (req, res) => {
  try {
    const filter = {};
    if (req.query.date) {
      const start = dayStart(req.query.date);
      const end = new Date(start);
      end.setHours(23, 59, 59, 999);
      filter.date = { $gte: start, $lte: end };
    } else if (req.query.year) {
      const y = parseInt(req.query.year, 10);
      filter.date = { $gte: new Date(y, 0, 1), $lte: new Date(y, 11, 31, 23, 59, 59, 999) };
    }
    const notes = await Note.find(filter)
      .sort({ date: 1, createdAt: 1 })
      .populate("user", "name email");
    res.json(notes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { date, text } = req.body;
    if (!date || !text || !String(text).trim()) {
      return res.status(400).json({ message: "Date and text are required" });
    }
    const note = await Note.create({
      user: req.user.id,
      date: dayStart(date),
      text: String(text).trim(),
    });
    await note.populate("user", "name email");
    res.status(201).json(note);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ message: "Text is required" });
    }
    const note = await Note.findOneAndUpdate(
      { _id: req.params.id },
      { text: String(text).trim() },
      { new: true, runValidators: true }
    ).populate("user", "name email");
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json(note);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const note = await Note.findOneAndDelete({ _id: req.params.id });
    if (!note) return res.status(404).json({ message: "Note not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
