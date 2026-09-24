const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL || "https://vetridigital.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Independent of DB connectivity, same as on the always-on server.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Every invocation needs a ready DB connection — there is no boot-time
// `connectDB()` call like a long-running server would have (config/db.js
// caches the connection across warm invocations of the same function).
app.use(async (_req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("[db] connection failed:", err.message);
    res.status(500).json({ message: "Database connection failed" });
  }
});

app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/transactions", require("./routes/transaction.routes"));
app.use("/api/reports", require("./routes/report.routes"));
app.use("/api/notes", require("./routes/note.routes"));
app.use("/api/notebook", require("./routes/notebook.routes"));
app.use("/api/payroll", require("./routes/payroll.routes"));
app.use("/api/cash-overview", require("./routes/cashOverview.routes"));

app.use("/api/cron", require("./routes/cron.routes"));
app.use("/api/admin", require("./routes/admin.routes"));

module.exports = app;
