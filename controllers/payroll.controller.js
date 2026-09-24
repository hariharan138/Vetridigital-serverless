const PayrollRule = require("../models/PayrollRule");
const Transaction = require("../models/Transaction");

function dayStart(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, day);
  }
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  const x = dayStart(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonths(date, n) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  if (d.getDate() < day) d.setDate(0);
  return dayStart(d);
}

function nextDue(from, frequencyType, frequencyValue) {
  if (frequencyType === "monthly") return addMonths(from, 1);
  const days =
    frequencyType === "weekly" ? 7 : Math.max(1, Number(frequencyValue) || 7);
  const d = dayStart(from);
  d.setDate(d.getDate() + days);
  return d;
}

function freqLabel(type, value) {
  if (type === "weekly") return "Weekly";
  if (type === "monthly") return "Monthly";
  if (type === "custom") return `Every ${value} days`;
  return `Every ${value} days`;
}

function generateDueDates(startDate, frequencyType, frequencyValue, until) {
  const dates = [];
  let cur = dayStart(startDate);
  const end = dayStart(until);
  for (let i = 0; i < 520 && cur <= end; i++) {
    dates.push(new Date(cur));
    cur = nextDue(cur, frequencyType, frequencyValue);
  }
  // Include next upcoming due after horizon
  if (!dates.length || dayStart(dates[dates.length - 1]) < cur) {
    dates.push(new Date(cur));
  }
  return dates;
}

function remarkMatch(txRemark, ruleRemark) {
  return String(txRemark || "")
    .trim()
    .toLowerCase() === String(ruleRemark || "").trim().toLowerCase();
}

function findOverride(overrides, due) {
  const key = dayKey(due);
  return (overrides || []).find((o) => dayKey(o.dueDate) === key) || null;
}

function resolveCycleStatus({ due, expected, actual, hasTx, override, today }) {
  if (override?.action === "ignore") {
    return { status: "ignored", label: "Ignored" };
  }
  if (override?.action === "mark_paid") {
    return { status: "paid", label: "Paid" };
  }

  const dueDay = dayStart(due);
  const todayDay = dayStart(today);

  if (!hasTx) {
    if (dueDay < todayDay) return { status: "overdue", label: "Overdue" };
    return { status: "no_transaction", label: "No Transaction Found" };
  }

  if (actual < expected) return { status: "under_paid", label: "Under Paid" };
  if (actual > expected) return { status: "over_paid", label: "Over Paid" };
  return { status: "paid", label: "Paid" };
}

function buildCycles(rule, transactions, today = new Date()) {
  const todayDay = dayStart(today);
  // Generate from start through today, plus next upcoming
  const horizon = nextDue(todayDay, rule.frequencyType, rule.frequencyValue);
  const dueDates = generateDueDates(
    rule.startDate,
    rule.frequencyType,
    rule.frequencyValue,
    horizon
  );

  const matched = new Set();
  const txs = transactions
    .filter((t) => remarkMatch(t.remark, rule.remark))
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const cycles = dueDates.map((due, idx) => {
    const next = dueDates[idx + 1]
      ? dayStart(dueDates[idx + 1])
      : nextDue(due, rule.frequencyType, rule.frequencyValue);
    const override = findOverride(rule.overrides, due);

    let expected = rule.expectedAmount;
    if (override?.expectedAmount != null && override.expectedAmount >= 0) {
      expected = override.expectedAmount;
    }

    let tx = null;
    if (override?.linkedTransaction) {
      tx =
        transactions.find(
          (t) => String(t._id) === String(override.linkedTransaction)
        ) || null;
      if (tx) matched.add(String(tx._id));
    }

    if (!tx) {
      // Window: [due, next due). Prefer earliest unused matching tx in window.
      // Also allow txs slightly before due (same day window starts at due day).
      const windowStart = dayStart(due);
      const windowEnd = dayStart(next);
      tx =
        txs.find((t) => {
          if (matched.has(String(t._id))) return false;
          const td = dayStart(t.date);
          return td >= windowStart && td < windowEnd;
        }) || null;

      // Overdue catch-up: if past due and no tx in window, take nearest unused after due
      if (!tx && dayStart(due) < todayDay) {
        tx =
          txs.find((t) => {
            if (matched.has(String(t._id))) return false;
            return dayStart(t.date) >= dayStart(due);
          }) || null;
      }

      if (tx) matched.add(String(tx._id));
    }

    const actual = tx ? Number(tx.amount) : override?.action === "mark_paid" ? expected : 0;
    const hasTx = !!tx || override?.action === "mark_paid";
    const { status, label } = resolveCycleStatus({
      due,
      expected,
      actual,
      hasTx,
      override,
      today: todayDay,
    });

    return {
      dueDate: due,
      dueKey: dayKey(due),
      expectedAmount: expected,
      actualAmount: hasTx ? actual : null,
      difference: hasTx ? actual - expected : null,
      transactionDate: tx ? tx.date : null,
      transactionId: tx ? tx._id : null,
      remark: tx ? tx.remark : rule.remark,
      status,
      statusLabel: label,
      notes: override?.notes || "",
      overrideAction: override?.action || null,
    };
  });

  return cycles;
}

function employeeSummary(rule, cycles, today = new Date()) {
  const todayDay = dayStart(today);
  const pastOrDue = cycles.filter((c) => dayStart(c.dueDate) <= todayDay);
  const lastPaid = [...cycles]
    .filter((c) => c.transactionDate || c.status === "paid")
    .sort((a, b) => new Date(b.dueDate) - new Date(a.dueDate))[0];
  const nextDueCycle = cycles.find(
    (c) =>
      dayStart(c.dueDate) >= todayDay &&
      (c.status === "no_transaction" || c.status === "overdue" || c.status === "under_paid")
  ) || cycles.find((c) => dayStart(c.dueDate) >= todayDay);

  const latestStatus =
    pastOrDue.length > 0 ? pastOrDue[pastOrDue.length - 1].status : "no_transaction";

  return {
    _id: rule._id,
    employeeName: rule.employeeName,
    remark: rule.remark,
    frequency: freqLabel(rule.frequencyType, rule.frequencyValue),
    frequencyType: rule.frequencyType,
    frequencyValue: rule.frequencyValue,
    expectedAmount: rule.expectedAmount,
    startDate: rule.startDate,
    reminderDays: rule.reminderDays,
    active: rule.active,
    nextDue: nextDueCycle?.dueDate || null,
    status: latestStatus,
    lastPayment: lastPaid?.transactionDate || lastPaid?.dueDate || null,
    cycles,
  };
}

function buildReminders(summaries, today = new Date()) {
  const todayDay = dayStart(today);
  const reminders = [];

  for (const s of summaries) {
    if (!s.active) continue;
    for (const c of s.cycles) {
      const due = dayStart(c.dueDate);
      const diffDays = Math.round((due - todayDay) / 86400000);

      if (c.status === "overdue") {
        const overdueBy = Math.round((todayDay - due) / 86400000);
        reminders.push({
          type: "overdue",
          severity: "high",
          message: `${s.employeeName} payment overdue by ${overdueBy} day${overdueBy === 1 ? "" : "s"}.`,
          employeeName: s.employeeName,
          dueDate: c.dueDate,
          ruleId: s._id,
        });
      } else if (
        (c.status === "no_transaction" || c.status === "under_paid") &&
        diffDays >= 0 &&
        diffDays <= (s.reminderDays || 1)
      ) {
        const when =
          diffDays === 0 ? "today" : diffDays === 1 ? "tomorrow" : `in ${diffDays} days`;
        reminders.push({
          type: "upcoming",
          severity: "medium",
          message: `${s.employeeName} payment is due ${when}.`,
          employeeName: s.employeeName,
          dueDate: c.dueDate,
          ruleId: s._id,
        });
      }

      if (c.status === "under_paid") {
        reminders.push({
          type: "underpayment",
          severity: "medium",
          message: `Underpayment detected for ${s.employeeName}.`,
          employeeName: s.employeeName,
          dueDate: c.dueDate,
          ruleId: s._id,
        });
      }
    }
  }

  // Dedupe similar messages
  const seen = new Set();
  return reminders.filter((r) => {
    const k = `${r.type}:${r.ruleId}:${dayKey(r.dueDate)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildAnalytics(summaries, today = new Date()) {
  const todayDay = dayStart(today);
  let paid = 0;
  let due = 0;
  let under = 0;
  let over = 0;
  let missed = 0;
  let totalPaidAmt = 0;
  let totalDueAmt = 0;
  let delaySum = 0;
  let delayCount = 0;

  for (const s of summaries) {
    for (const c of s.cycles) {
      if (dayStart(c.dueDate) > todayDay) continue;
      if (c.status === "ignored") continue;

      due += 1;
      totalDueAmt += c.expectedAmount || 0;

      if (c.status === "paid") paid += 1;
      if (c.status === "under_paid") under += 1;
      if (c.status === "over_paid") {
        over += 1;
        paid += 1; // still a payment received
      }
      if (c.status === "overdue" || c.status === "no_transaction") missed += 1;

      if (c.actualAmount != null) totalPaidAmt += c.actualAmount;

      if (c.transactionDate) {
        const delay = Math.round(
          (dayStart(c.transactionDate) - dayStart(c.dueDate)) / 86400000
        );
        delaySum += Math.max(0, delay);
        delayCount += 1;
      }
    }
  }

  const successBase = due || 1;
  return {
    paymentSuccessPct: Math.round(((paid) / successBase) * 1000) / 10,
    averageDelay: delayCount ? Math.round((delaySum / delayCount) * 10) / 10 : 0,
    totalPaid: totalPaidAmt,
    totalDue: totalDueAmt,
    underpayments: under,
    overpayments: over,
    missedPayments: missed,
  };
}

function buildDashboard(summaries, today = new Date()) {
  const todayDay = dayStart(today);
  let totalExpected = 0;
  let totalPaid = 0;
  let pendingAmount = 0;
  let overpaidAmount = 0;
  let nextDueDate = null;
  let lastPaymentDate = null;

  for (const s of summaries) {
    if (!s.active) continue;
    for (const c of s.cycles) {
      if (dayStart(c.dueDate) > todayDay && c.status === "no_transaction") {
        if (!nextDueDate || dayStart(c.dueDate) < dayStart(nextDueDate)) {
          nextDueDate = c.dueDate;
        }
        continue;
      }
      if (dayStart(c.dueDate) > todayDay) continue;
      if (c.status === "ignored") continue;

      totalExpected += c.expectedAmount || 0;
      if (c.actualAmount != null) totalPaid += c.actualAmount;

      if (c.status === "overdue" || c.status === "no_transaction") {
        pendingAmount += c.expectedAmount || 0;
      } else if (c.status === "under_paid") {
        pendingAmount += Math.max(0, (c.expectedAmount || 0) - (c.actualAmount || 0));
      } else if (c.status === "over_paid") {
        overpaidAmount += Math.max(0, (c.actualAmount || 0) - (c.expectedAmount || 0));
      }

      if (c.transactionDate) {
        if (!lastPaymentDate || new Date(c.transactionDate) > new Date(lastPaymentDate)) {
          lastPaymentDate = c.transactionDate;
        }
      }
    }

    if (s.nextDue && (!nextDueDate || dayStart(s.nextDue) < dayStart(nextDueDate))) {
      nextDueDate = s.nextDue;
    }
  }

  return {
    totalExpected,
    totalPaid,
    pendingAmount,
    overpaidAmount,
    nextDueDate,
    lastPaymentDate,
  };
}

async function loadMatchedPayload(userId, query = {}) {
  const filter = { user: userId };
  if (query.active === "true") filter.active = true;
  if (query.active === "false") filter.active = false;
  if (query.frequency) filter.frequencyType = query.frequency;
  if (query.employee) {
    filter.employeeName = new RegExp(String(query.employee).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  const rules = await PayrollRule.find(filter).sort({ employeeName: 1 });

  let transactions = [];
  if (rules.length) {
    const remarkOr = rules.map((r) => ({
      remark: new RegExp(
        `^${String(r.remark).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      ),
    }));
    const txFilter = { $or: remarkOr };
    // Load all matching remark txs so cycle windows resolve correctly
    transactions = await Transaction.find(txFilter).sort({ date: 1 });
  }

  const today = new Date();
  let summaries = rules.map((rule) => {
    const cycles = buildCycles(rule, transactions, today);
    return employeeSummary(rule, cycles, today);
  });

  if (query.status) {
    summaries = summaries.filter((s) => s.status === query.status);
  }

  if (query.startDate || query.endDate) {
    const from = query.startDate ? dayStart(query.startDate) : null;
    const to = query.endDate ? dayStart(query.endDate) : null;
    summaries = summaries.map((s) => ({
      ...s,
      cycles: s.cycles.filter((c) => {
        const d = dayStart(c.dueDate);
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      }),
    }));
  }

  return {
    employees: summaries,
    dashboard: buildDashboard(summaries, today),
    reminders: buildReminders(summaries, today),
    analytics: buildAnalytics(summaries, today),
  };
}

exports.getDashboard = async (req, res) => {
  try {
    const payload = await loadMatchedPayload(req.user.id, req.query);
    res.json(payload);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const rule = await PayrollRule.findOne({ _id: req.params.id, user: req.user.id });
    if (!rule) return res.status(404).json({ message: "Payroll rule not found" });

    const transactions = await Transaction.find({
      remark: new RegExp(
        `^${String(rule.remark).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      ),
    }).sort({ date: 1 });
    const cycles = buildCycles(rule, transactions);
    res.json(employeeSummary(rule, cycles));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const {
      employeeName,
      remark,
      startDate,
      expectedAmount,
      frequencyType,
      frequencyValue,
      reminderDays,
      active,
    } = req.body;

    if (!employeeName?.trim() || !remark?.trim() || !startDate || expectedAmount == null) {
      return res.status(400).json({ message: "Employee name, remark, start date and amount are required" });
    }
    if (!["days", "weekly", "monthly", "custom"].includes(frequencyType)) {
      return res.status(400).json({ message: "Invalid frequency type" });
    }

    const rule = await PayrollRule.create({
      user: req.user.id,
      employeeName: String(employeeName).trim(),
      remark: String(remark).trim(),
      startDate: dayStart(startDate),
      expectedAmount: Number(expectedAmount),
      frequencyType,
      frequencyValue:
        frequencyType === "weekly" ? 7 : Math.max(1, Number(frequencyValue) || 7),
      reminderDays: [1, 2, 3].includes(Number(reminderDays)) ? Number(reminderDays) : 1,
      active: active !== false,
    });

    res.status(201).json(rule);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const allowed = [
      "employeeName",
      "remark",
      "startDate",
      "expectedAmount",
      "frequencyType",
      "frequencyValue",
      "reminderDays",
      "active",
    ];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (updates.employeeName) updates.employeeName = String(updates.employeeName).trim();
    if (updates.remark) updates.remark = String(updates.remark).trim();
    if (updates.startDate) updates.startDate = dayStart(updates.startDate);
    if (updates.expectedAmount != null) updates.expectedAmount = Number(updates.expectedAmount);
    if (updates.frequencyType === "weekly") updates.frequencyValue = 7;
    if (updates.frequencyValue != null) {
      updates.frequencyValue = Math.max(1, Number(updates.frequencyValue) || 7);
    }
    if (updates.reminderDays != null) {
      updates.reminderDays = [1, 2, 3].includes(Number(updates.reminderDays))
        ? Number(updates.reminderDays)
        : 1;
    }

    const rule = await PayrollRule.findOneAndUpdate(
      { _id: req.params.id, user: req.user.id },
      updates,
      { new: true, runValidators: true }
    );
    if (!rule) return res.status(404).json({ message: "Payroll rule not found" });
    res.json(rule);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const rule = await PayrollRule.findOneAndDelete({
      _id: req.params.id,
      user: req.user.id,
    });
    if (!rule) return res.status(404).json({ message: "Payroll rule not found" });
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.setOverride = async (req, res) => {
  try {
    const { dueDate, action, expectedAmount, linkedTransaction, notes } = req.body;
    if (!dueDate || !action) {
      return res.status(400).json({ message: "dueDate and action are required" });
    }
    const valid = ["mark_paid", "ignore", "link", "adjust", "note", "clear"];
    if (!valid.includes(action)) {
      return res.status(400).json({ message: "Invalid action" });
    }

    const rule = await PayrollRule.findOne({ _id: req.params.id, user: req.user.id });
    if (!rule) return res.status(404).json({ message: "Payroll rule not found" });

    const key = dayKey(dueDate);
    rule.overrides = (rule.overrides || []).filter((o) => dayKey(o.dueDate) !== key);

    if (action !== "clear") {
      const entry = {
        dueDate: dayStart(dueDate),
        action: action === "adjust" ? "adjust" : action,
        notes: notes != null ? String(notes) : "",
      };
      if (expectedAmount != null) entry.expectedAmount = Number(expectedAmount);
      if (linkedTransaction) entry.linkedTransaction = linkedTransaction;
      if (action === "link" && !linkedTransaction) {
        return res.status(400).json({ message: "linkedTransaction is required for link" });
      }
      // mark_paid / ignore can also carry notes and amount adjust
      if (action === "mark_paid" || action === "ignore") {
        entry.action = action;
      }
      rule.overrides.push(entry);
    }

    await rule.save();

    const transactions = await Transaction.find({
      remark: new RegExp(
        `^${String(rule.remark).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        "i"
      ),
    }).sort({ date: 1 });
    const cycles = buildCycles(rule, transactions);
    res.json(employeeSummary(rule, cycles));
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

exports.searchTransactions = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);
    const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const txs = await Transaction.find({ remark: re })
      .sort({ date: -1 })
      .limit(50)
      .select("amount remark date type");
    res.json(txs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
