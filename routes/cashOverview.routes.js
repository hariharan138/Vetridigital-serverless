const router = require("express").Router();
const protect = require("../middleware/auth");
const ctrl = require("../controllers/cashOverview.controller");

router.use(protect);

router.get("/", ctrl.get);
router.put("/", ctrl.update);

module.exports = router;
