const router = require("express").Router();
const protect = require("../middleware/auth");
const ctrl = require("../controllers/transaction.controller");

router.use(protect); // All transaction routes require auth

router.get("/all", ctrl.getAllCommon);
router.get("/", ctrl.getAll);
router.post("/", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);
router.post("/:id/collect", ctrl.collectPending);
router.get("/daily-summary", ctrl.dailySummary);
router.get("/monthly-summary", ctrl.monthlySummary);

module.exports = router;
