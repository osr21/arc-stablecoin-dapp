import { Router, type IRouter } from "express";
import { getKeeperStatus } from "../lib/keeper";

const router: IRouter = Router();

router.get("/status", (_req, res) => {
  res.json(getKeeperStatus());
});

export default router;
