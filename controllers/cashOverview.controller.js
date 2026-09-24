const CashOverview = require("../models/CashOverview");

exports.get = async (req, res) => {
  try {
    const doc = await CashOverview.findOne({});
    res.json({
      totalExpenseOverride: doc?.totalExpenseOverride ?? null,
      inHand: doc?.inHand ?? 0,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const updates = {};
    if (req.body.totalExpenseOverride !== undefined) {
      updates.totalExpenseOverride = req.body.totalExpenseOverride;
    }
    if (req.body.inHand !== undefined) {
      updates.inHand = req.body.inHand;
    }
    const doc = await CashOverview.findOneAndUpdate({}, updates, {
      new: true,
      upsert: true,
    });
    res.json({
      totalExpenseOverride: doc.totalExpenseOverride,
      inHand: doc.inHand,
    });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};
