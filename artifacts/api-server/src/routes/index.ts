import { Router, type IRouter } from "express";
import healthRouter from "./health";
import versesRouter from "./verses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(versesRouter);

export default router;
