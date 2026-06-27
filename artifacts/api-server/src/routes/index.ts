import { Router, type IRouter } from "express";
import healthRouter from "./health";
import escrowRouter from "./escrow";
import vestingRouter from "./vesting";
import crosschainRouter from "./crosschain";
import cctpRouter from "./cctp";
import dashboardRouter from "./dashboard";
import keeperRouter from "./keeper";
import x402payRouter from "./x402pay";
import fxForwardRouter from "./fx-forward";
import htlcRouter from "./htlc";
import agentRouter from "./agents";
import splitRouter from "./splits";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/escrows", escrowRouter);
router.use("/vesting", vestingRouter);
router.use("/crosschain", crosschainRouter);
router.use("/cctp", cctpRouter);
router.use("/dashboard", dashboardRouter);
router.use("/keeper", keeperRouter);
router.use("/x402", x402payRouter);
router.use("/fx-forwards", fxForwardRouter);
router.use("/htlc", htlcRouter);
router.use("/agents", agentRouter);
router.use("/splits", splitRouter);

export default router;
