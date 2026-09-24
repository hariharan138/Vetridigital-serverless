const router = require("express").Router();
const protect = require("../middleware/auth");
const ctrl = require("../controllers/payroll.controller");

router.use(protect);

router.get("/", ctrl.getDashboard);
router.get("/transactions/search", ctrl.searchTransactions);
router.get("/:id", ctrl.getOne);
router.post("/", ctrl.create);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);
router.put("/:id/override", ctrl.setOverride);

module.exports = router;
