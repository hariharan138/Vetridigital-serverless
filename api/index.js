// Vercel's Node.js runtime calls this export as `(req, res)` — an Express
// app already has that exact signature, so no AWS-Lambda-style adapter
// (e.g. serverless-http, which targets API Gateway events) is needed here.
module.exports = require("../app");
