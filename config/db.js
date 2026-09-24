const mongoose = require("mongoose");

// Serverless functions can receive multiple concurrent invocations in the same
// container, and a fresh container on every cold start. Caching the connection
// promise on `global` avoids opening a new MongoDB connection per invocation
// and avoids racing two connection attempts on concurrent cold-start requests.
let cached = global._mongoose;
if (!cached) cached = global._mongoose = { conn: null, promise: null };

async function connectDB() {
  if (cached.conn) return cached.conn;

  const uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URL;

  if (!uri) {
    throw new Error(
      "Missing MongoDB connection string. Set MONGO_URI (or MONGODB_URI / DATABASE_URL / MONGO_URL) in your Vercel project env vars or local .env."
    );
  }

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error("Invalid MongoDB URI scheme. Connection string must start with mongodb:// or mongodb+srv://.");
  }

  if (!cached.promise) {
    cached.promise = mongoose
      .connect(uri, {
        bufferCommands: false,
        // A serverless function only ever needs a handful of connections at
        // once (not Mongoose's default pool of 100) — a smaller pool opens
        // faster on a cold start and avoids piling up idle sockets on Atlas
        // when many function instances are warm at the same time.
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 5000,
      })
      .then((m) => {
        console.log("MongoDB Connected");
        return m;
      });
  }

  cached.conn = await cached.promise;
  return cached.conn;
}

module.exports = connectDB;
