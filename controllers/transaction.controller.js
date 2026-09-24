const mongoose = require("mongoose");
const Transaction = require("../models/Transaction");

// GET all transactions with optional filters
exports.getAll = async (req, res) => {
  try {
    const { type, startDate, endDate, status } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59));
    }

    const transactions = await Transaction.find(filter).sort({ date: -1, createdAt: -1 }).populate("user", "name email");
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET all transactions across all users (common view)
exports.getAllCommon = async (req, res) => {
  try {
    const { type, startDate, endDate, status } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(new Date(endDate).setHours(23, 59, 59));
    }
    const transactions = await Transaction.find(filter).sort({ date: -1, createdAt: -1 }).populate("user", "name email");
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// POST create transaction
exports.create = async (req, res) => {
  try {
    const { type, amount, remark, date, shared, isPendingOrder, isUnconfirmed, totalOrderAmount, advanceAmount, paymentMethod } = req.body;
    const User = require("../models/User");
    const current = await User.findById(req.user.id).select("role");

    const txBody = {
      user: req.user.id,
      type,
      remark,
      date,
      paymentMethod: paymentMethod || "Cash",
    };

    if (shared && current && current.role === "admin") txBody.shared = true;

    if (isUnconfirmed) {
      txBody.amount = 0;
      txBody.status = "unconfirmed";
    } else if (isPendingOrder) {
      if (!totalOrderAmount || totalOrderAmount <= 0) {
        return res.status(400).json({ message: "Total Order Amount is required for pending orders" });
      }
      if (advanceAmount == null || advanceAmount < 0) {
        return res.status(400).json({ message: "Advance Amount is required for pending orders" });
      }
      if (advanceAmount > totalOrderAmount) {
        return res.status(400).json({ message: "Advance Amount cannot exceed Total Order Amount" });
      }

      txBody.isPendingOrder = true;
      txBody.totalOrderAmount = Number(totalOrderAmount);
      txBody.advanceAmount = Number(advanceAmount);
      txBody.pendingAmount = Number(totalOrderAmount) - Number(advanceAmount);
      txBody.amount = Number(advanceAmount);

      if (Number(advanceAmount) === 0) {
        txBody.status = "pending";
      } else if (Number(advanceAmount) < Number(totalOrderAmount)) {
        txBody.status = "partially_paid";
      } else {
        txBody.status = "completed";
      }
    } else {
      txBody.amount = Number(amount);
      txBody.status = "completed";
    }

    const tx = await Transaction.create(txBody);
    res.status(201).json(tx);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// PUT update transaction
exports.update = async (req, res) => {
  try {
    const updateBody = { ...req.body };

    if (updateBody.isUnconfirmed) {
      updateBody.amount = 0;
      updateBody.status = "unconfirmed";
      updateBody.isPendingOrder = false;
      updateBody.totalOrderAmount = undefined;
      updateBody.advanceAmount = undefined;
      updateBody.pendingAmount = 0;
    } else if (updateBody.isPendingOrder) {
      const total = Number(updateBody.totalOrderAmount);
      const advance = Number(updateBody.advanceAmount);
      updateBody.totalOrderAmount = total;
      updateBody.advanceAmount = advance;
      updateBody.pendingAmount = total - advance;
      updateBody.amount = advance;

      if (advance === 0) updateBody.status = "pending";
      else if (updateBody.pendingAmount > 0) updateBody.status = "partially_paid";
      else updateBody.status = "completed";
    } else {
      updateBody.amount = Number(updateBody.amount);
      updateBody.status = "completed";
      updateBody.isPendingOrder = false;
      updateBody.pendingAmount = 0;
    }

    const tx = await Transaction.findOneAndUpdate(
      { _id: req.params.id },
      updateBody,
      { new: true, runValidators: true }
    );
    if (!tx) return res.status(404).json({ message: "Transaction not found" });
    res.json(tx);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// POST collect pending payment (each installment registers on its own date)
exports.collectPending = async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ message: "Transaction not found" });
    if (!tx.isPendingOrder) return res.status(400).json({ message: "Not a pending order" });
    if (tx.status === "completed") return res.status(400).json({ message: "Payment already fully collected" });

    const pending = Number(tx.pendingAmount) || 0;
    if (pending <= 0) return res.status(400).json({ message: "Nothing left to collect" });

    const collectAmount = req.body.amount != null ? Number(req.body.amount) : pending;
    if (!collectAmount || collectAmount <= 0) {
      return res.status(400).json({ message: "Collect amount must be greater than 0" });
    }
    if (collectAmount > pending) {
      return res.status(400).json({ message: "Collect amount cannot exceed pending amount" });
    }

    const collectDate = req.body.date || new Date().toISOString().slice(0, 10);
    const paymentMethod = req.body.paymentMethod || tx.paymentMethod || "Cash";

    // Separate income row so this payment hits its own day (not the first-payment date)
    const payment = await Transaction.create({
      user: tx.user,
      type: "income",
      amount: collectAmount,
      remark: `Payment: ${tx.remark}`,
      date: collectDate,
      paymentMethod,
      shared: tx.shared,
      status: "completed",
    });

    tx.advanceAmount = (Number(tx.advanceAmount) || 0) + collectAmount;
    tx.pendingAmount = pending - collectAmount;
    // keep tx.amount = first installment only (already on tx.date)
    tx.status = tx.pendingAmount > 0 ? "partially_paid" : "completed";
    await tx.save();

    res.json({ order: tx, payment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// DELETE transaction
exports.remove = async (req, res) => {
  try {
    const tx = await Transaction.findOneAndDelete({ _id: req.params.id });
    if (!tx) return res.status(404).json({ message: "Not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET daily summary
exports.dailySummary = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate.setHours(0, 0, 0, 0));
    const end = new Date(targetDate.setHours(23, 59, 59, 999));

    const transactions = await Transaction.find({
      $or: [{ user: req.user.id }, { shared: true }],
      date: { $gte: start, $lte: end },
    }).populate("user", "name email");

    const totalIncome = transactions
      .filter((t) => t.type === "income")
      .reduce((s, t) => s + t.amount, 0);
    const totalExpense = transactions
      .filter((t) => t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);
    const totalPending = transactions
      .filter((t) => t.isPendingOrder && t.status !== "completed")
      .reduce((s, t) => s + (t.pendingAmount || 0), 0);

    res.json({
      totalIncome,
      totalExpense,
      totalPending,
      net: totalIncome - totalExpense,
      transactions,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// GET monthly summary
exports.monthlySummary = async (req, res) => {
  try {
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year) || new Date().getFullYear();
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 0, 23, 59, 59);

    const result = await Transaction.aggregate([
      {
        $match: {
          $and: [
            { date: { $gte: start, $lte: end } },
            { $or: [{ user: new mongoose.Types.ObjectId(req.user.id) }, { shared: true }] },
          ],
        },
      },
      {
        $group: {
          _id: { type: "$type", status: "$status" },
          total: { $sum: "$amount" },
          totalPending: { $sum: "$pendingAmount" },
        },
      },
    ]);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
