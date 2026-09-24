const router = require("express").Router();
const protect = require("../middleware/auth");
const ctrl = require("../controllers/notebook.controller");

router.use(protect);

router.get("/meta", ctrl.getMeta);
router.get("/", ctrl.listNotes);
router.post("/", ctrl.create);

router.post("/folders", ctrl.createFolder);
router.put("/folders/:id", ctrl.updateFolder);
router.delete("/folders/:id", ctrl.deleteFolder);

router.get("/:id", ctrl.getOne);
router.put("/:id", ctrl.update);
router.delete("/:id", ctrl.softDelete);
router.post("/:id/restore", ctrl.restore);
router.delete("/:id/permanent", ctrl.permanentDelete);
router.post("/:id/duplicate", ctrl.duplicate);
router.post("/:id/versions/:versionId/restore", ctrl.restoreVersion);

module.exports = router;
