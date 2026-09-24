// Local-only entry point (`bun run dev:express` / `node server.js`).
// Vercel never runs this file — it invokes api/index.js as a serverless function.
require("dotenv").config();
const app = require("./app");

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Local dev server running on port ${PORT}`);
});
