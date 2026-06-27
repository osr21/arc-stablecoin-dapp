import { useState, useCallback, useEffect } from "react";
import { isAddress } from "viem";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useWallet } from "../lib/wallet";
import {
  CONTRACT_ADDRESSES,
  BATCH_TRANSFER_ABI,
  ERC20_ABI,
  ARC_TESTNET,
  parseToken,
  formatToken,
} from "../lib/contracts";
import {
  Plus,
  Trash2,
  Layers,
  Info,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Loader2,
  Circle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Row {
  id: string;
  recipient: string;
  amount: string;
  token: "USDC" | "EURC";
}

interface Step {
  label: string;
  state: "pending" | "active" | "done" | "error";
  txHash?: string;
  error?: string;
}

type SendStatus =
  | { phase: "idle" }
  | { phase: "running"; steps: Step[] }
  | { phase: "done"; steps: Step[] }
  | { phase: "error"; steps: Step[]; error: string };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2);
}

const TOKEN_ADDRESS: Record<"USDC" | "EURC", `0x${string}`> = {
  USDC: CONTRACT_ADDRESSES.USDC,
  EURC: CONTRACT_ADDRESSES.EURC,
};

const MAX_UINT256 = 2n ** 256n - 1n;

// ─── Component ───────────────────────────────────────────────────────────────

export default function Batch() {
  const { address, walletClient, publicClient, isConnected } = useWallet();

  const [rows, setRows] = useState<Row[]>([
    { id: uid(), recipient: "", amount: "", token: "USDC" },
  ]);
  const [memo, setMemo] = useState("");
  const [globalToken, setGlobalToken] = useState<"USDC" | "EURC">("USDC");
  const [status, setStatus] = useState<SendStatus>({ phase: "idle" });
  const [showInfo, setShowInfo] = useState(false);
  const [balances, setBalances] = useState<Record<"USDC" | "EURC", bigint | null>>({ USDC: null, EURC: null });
  const [balanceLoading, setBalanceLoading] = useState(false);

  // ─── Balance fetch ────────────────────────────────────────────────────────

  const fetchBalances = useCallback(async () => {
    if (!address || !publicClient) return;
    setBalanceLoading(true);
    try {
      const [usdc, eurc] = await Promise.all([
        publicClient.readContract({ address: CONTRACT_ADDRESSES.USDC, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
        publicClient.readContract({ address: CONTRACT_ADDRESSES.EURC, abi: ERC20_ABI, functionName: "balanceOf", args: [address] }),
      ]);
      setBalances({ USDC: usdc as bigint, EURC: eurc as bigint });
    } catch { /* ignore */ } finally {
      setBalanceLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => { fetchBalances(); }, [fetchBalances]);

  // ─── Row helpers ──────────────────────────────────────────────────────────

  const addRow = () =>
    setRows(r => [...r, { id: uid(), recipient: "", amount: "", token: globalToken }]);

  const removeRow = (id: string) =>
    setRows(r => r.length > 1 ? r.filter(row => row.id !== id) : r);

  const updateRow = (id: string, field: keyof Omit<Row, "id">, value: string) =>
    setRows(r => r.map(row => (row.id === id ? { ...row, [field]: value } : row)));

  const applyTokenToAll = (token: "USDC" | "EURC") => {
    setGlobalToken(token);
    setRows(r => r.map(row => ({ ...row, token })));
  };

  // ─── Totals ───────────────────────────────────────────────────────────────

  const totals = rows.reduce<Record<"USDC" | "EURC", bigint>>(
    (acc, row) => {
      const n = row.amount && !isNaN(Number(row.amount)) ? parseToken(row.amount) : 0n;
      acc[row.token] += n;
      return acc;
    },
    { USDC: 0n, EURC: 0n },
  );

  // Groups rows by token, preserving order within each group.
  function groupByToken(): Array<{ token: "USDC" | "EURC"; recipients: `0x${string}`[]; amounts: bigint[]; total: bigint }> {
    const map = new Map<"USDC" | "EURC", { recipients: `0x${string}`[]; amounts: bigint[]; total: bigint }>();
    for (const row of rows) {
      if (!isAddress(row.recipient) || !row.amount || Number(row.amount) <= 0) continue;
      const amt = parseToken(row.amount);
      if (!map.has(row.token)) map.set(row.token, { recipients: [], amounts: [], total: 0n });
      const g = map.get(row.token)!;
      g.recipients.push(row.recipient as `0x${string}`);
      g.amounts.push(amt);
      g.total += amt;
    }
    return Array.from(map.entries()).map(([token, g]) => ({ token, ...g }));
  }

  // ─── Validation ───────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!isConnected || !address) return "Connect your wallet first.";
    if (rows.length === 0) return "Add at least one recipient.";
    for (const [i, row] of rows.entries()) {
      if (!isAddress(row.recipient)) return `Row ${i + 1}: invalid address.`;
      if (!row.amount || isNaN(Number(row.amount)) || Number(row.amount) <= 0)
        return `Row ${i + 1}: amount must be greater than 0.`;
    }
    return null;
  }

  // ─── Step state helpers ───────────────────────────────────────────────────

  function setStepState(
    stepsCopy: Step[],
    idx: number,
    patch: Partial<Step>,
  ): Step[] {
    const next = stepsCopy.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    setStatus(st => ({ ...(st as any), steps: next }));
    return next;
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  const send = useCallback(async () => {
    const err = validate();
    if (err) { setStatus({ phase: "error", steps: [], error: err }); return; }
    if (!walletClient || !address) return;

    const groups = groupByToken();
    if (groups.length === 0) {
      setStatus({ phase: "error", steps: [], error: "No valid recipients." });
      return;
    }

    // Build steps: for each token group → approve + batchTransfer.
    // The memo is passed directly into batchTransfer() and emitted in the
    // BatchExecuted event — no separate transaction needed.
    const initialSteps: Step[] = [];
    for (const g of groups) {
      initialSteps.push({ label: `Approve ${formatToken(g.total)} ${g.token}`, state: "pending" });
      initialSteps.push({
        label: `Send to ${g.recipients.length} recipient${g.recipients.length > 1 ? "s" : ""} (${g.token})`,
        state: "pending",
      });
    }

    let steps = [...initialSteps];
    setStatus({ phase: "running", steps });

    try {
      let stepIdx = 0;

      for (const g of groups) {
        const tokenAddr = TOKEN_ADDRESS[g.token];

        // ── Approve ──────────────────────────────────────────────────────────
        steps = setStepState(steps, stepIdx, { state: "active" });

        // Check existing allowance to skip if already sufficient.
        let allowance: bigint = 0n;
        try {
          allowance = (await publicClient.readContract({
            address: tokenAddr,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, CONTRACT_ADDRESSES.BATCH_TRANSFER],
          })) as bigint;
        } catch { /* default 0 */ }

        if (allowance < g.total) {
          const approveTx = await walletClient.writeContract({
            address: tokenAddr,
            abi: ERC20_ABI,
            functionName: "approve",
            args: [CONTRACT_ADDRESSES.BATCH_TRANSFER, MAX_UINT256],
            account: address,
            chain: ARC_TESTNET as any,
            gas: 100_000n,
          });
          const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx, confirmations: 1 });
          if (approveReceipt.status === "reverted") throw new Error(`${g.token} approval reverted.`);
          steps = setStepState(steps, stepIdx, { state: "done", txHash: approveTx });
        } else {
          steps = setStepState(steps, stepIdx, { state: "done" });
        }
        stepIdx++;

        // ── batchTransfer ─────────────────────────────────────────────────────
        steps = setStepState(steps, stepIdx, { state: "active" });

        const batchTx = await walletClient.writeContract({
          address: CONTRACT_ADDRESSES.BATCH_TRANSFER,
          abi: BATCH_TRANSFER_ABI,
          functionName: "batchTransfer",
          args: [tokenAddr, g.recipients, g.amounts, memo.trim()],
          account: address,
          chain: ARC_TESTNET as any,
          gas: 80_000n + BigInt(g.recipients.length) * 60_000n,
        });
        const batchReceipt = await publicClient.waitForTransactionReceipt({ hash: batchTx, confirmations: 1 });
        if (batchReceipt.status === "reverted") throw new Error(`${g.token} batch transfer reverted.`);
        steps = setStepState(steps, stepIdx, { state: "done", txHash: batchTx });
        stepIdx++;
      }

      setStatus({ phase: "done", steps });
      fetchBalances();
    } catch (e: any) {
      const msg = e?.shortMessage ?? e?.message ?? "Transaction failed.";
      // Mark the active step as errored.
      const errSteps = steps.map(s => (s.state === "active" ? { ...s, state: "error" as const, error: msg } : s));
      setStatus({ phase: "error", steps: errSteps, error: msg });
    }
  }, [rows, memo, address, walletClient, publicClient, isConnected, fetchBalances]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const validationErr = validate();
  const isBusy = status.phase === "running";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold tracking-tight">Batch Transfer</h1>
          <Badge variant="outline" className="text-xs font-mono text-primary border-primary/40">
            Arc Zero7 · On-chain
          </Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Send USDC or EURC to multiple wallets. One approval + one contract call — all recipients paid in a single transaction.
        </p>
      </div>

      {/* Info banner */}
      <Card className="border-primary/20 bg-primary/5 p-4">
        <button
          className="w-full flex items-start justify-between gap-3 text-left"
          onClick={() => setShowInfo(v => !v)}
        >
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <span className="text-sm font-medium text-primary">How it works</span>
          </div>
          {showInfo
            ? <ChevronUp className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            : <ChevronDown className="w-4 h-4 text-primary shrink-0 mt-0.5" />}
        </button>
        {showInfo && (
          <div className="mt-3 ml-7 text-sm text-muted-foreground space-y-2">
            <p>
              A <strong className="text-foreground">BatchTransfer</strong> smart contract (deployed on Arc Testnet at{" "}
              <a
                href={`https://testnet.arcscan.app/address/${CONTRACT_ADDRESSES.BATCH_TRANSFER}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-primary hover:underline"
              >
                {CONTRACT_ADDRESSES.BATCH_TRANSFER.slice(0, 10)}…
              </a>
              ) handles the distribution.
            </p>
            <ol className="list-decimal list-inside space-y-1">
              <li><strong className="text-foreground">Approve</strong> — you authorise the contract to pull the total amount from your wallet (one MetaMask confirmation per token).</li>
              <li><strong className="text-foreground">Send</strong> — the contract pulls the total and distributes to every recipient in one on-chain call (one MetaMask confirmation per token group).</li>
            </ol>
            <p>For an all-USDC batch of any size: <strong className="text-foreground">2 confirmations total</strong>, not one per recipient.</p>
            <a
              href="https://community.arc.io/home/blogs/transaction-memos-and-batch-transactions-activate-on-arc-testnet-2026-06-13"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline text-xs mt-1"
            >
              Arc Zero7 announcement <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: recipient table + memo */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="p-5 space-y-4">
            {/* Token switcher */}
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Recipients</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Token for all:</span>
                {(["USDC", "EURC"] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => applyTokenToAll(t)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-colors ${
                      globalToken === t
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Column headers */}
            <div className="grid grid-cols-[1fr_140px_80px_36px] gap-2 px-1">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Recipient Address</span>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Amount</span>
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Token</span>
              <span />
            </div>

            {/* Rows */}
            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={row.id} className="grid grid-cols-[1fr_140px_80px_36px] gap-2 items-center">
                  <Input
                    placeholder="0x…"
                    value={row.recipient}
                    onChange={e => updateRow(row.id, "recipient", e.target.value)}
                    disabled={isBusy}
                    className={`font-mono text-xs h-9 ${
                      row.recipient && !isAddress(row.recipient) ? "border-destructive focus-visible:ring-destructive" : ""
                    }`}
                  />
                  <Input
                    type="number"
                    placeholder="0.00"
                    min="0"
                    step="any"
                    value={row.amount}
                    onChange={e => updateRow(row.id, "amount", e.target.value)}
                    disabled={isBusy}
                    className="text-right h-9 text-sm"
                  />
                  <select
                    value={row.token}
                    onChange={e => updateRow(row.id, "token", e.target.value as "USDC" | "EURC")}
                    disabled={isBusy}
                    className="h-9 rounded-md border border-input bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option>USDC</option>
                    <option>EURC</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length === 1 || isBusy}
                    title={idx === 0 && rows.length === 1 ? "Need at least one row" : "Remove"}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button variant="outline" size="sm" onClick={addRow} disabled={isBusy} className="gap-1.5">
              <Plus className="w-4 h-4" /> Add Recipient
            </Button>
          </Card>

          {/* Memo */}
          <Card className="p-5 space-y-3">
            <div>
              <Label className="text-sm font-medium">
                Transaction Memo <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Emitted in the <span className="font-mono">BatchExecuted</span> event on-chain — stored inside the batch transaction itself, no extra confirmation needed.
              </p>
            </div>
            <Input
              placeholder="Payment for invoice #1234, batch payroll, etc."
              value={memo}
              onChange={e => setMemo(e.target.value)}
              maxLength={256}
              disabled={isBusy}
              className="text-sm"
            />
          </Card>
        </div>

        {/* Right: summary + send */}
        <div className="space-y-4">
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Your Balance</Label>
              {isConnected && (
                <button
                  onClick={fetchBalances}
                  disabled={balanceLoading || isBusy}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                  title="Refresh balances"
                >
                  {balanceLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "↻"}
                </button>
              )}
            </div>
            {isConnected ? (
              <div className="space-y-1.5">
                {(["USDC", "EURC"] as const).map(t => {
                  const bal = balances[t];
                  const spending = totals[t];
                  const insufficient = bal !== null && spending > 0n && spending > bal;
                  return (
                    <div key={t} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground font-mono text-xs">{t}</span>
                      <div className="text-right">
                        <span className={`font-mono font-medium ${insufficient ? "text-destructive" : ""}`}>
                          {bal === null ? <span className="text-muted-foreground text-xs">—</span> : `${formatToken(bal)} ${t}`}
                        </span>
                        {insufficient && (
                          <p className="text-xs text-destructive/80">insufficient</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Connect wallet to see balance.</p>
            )}
          </Card>

          <Card className="p-5 space-y-3">
            <Label className="text-sm font-medium">Summary</Label>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Recipients</span>
                <span className="font-medium">{rows.length}</span>
              </div>
              {(["USDC", "EURC"] as const).map(t => (
                <div key={t} className="flex items-center justify-between">
                  <span className="text-muted-foreground">Total {t}</span>
                  <span className={`font-mono font-medium ${totals[t] === 0n ? "text-muted-foreground" : ""}`}>
                    {formatToken(totals[t])} {t}
                  </span>
                </div>
              ))}
              <div className="border-t border-border pt-2 mt-2 space-y-1">
                {groupByToken().map(g => (
                  <div key={g.token} className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{g.token} confirmations</span>
                    <span className="font-mono">2 (approve + send)</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Button
            className="w-full gap-2 font-medium"
            size="lg"
            disabled={!isConnected || !!validationErr || isBusy}
            onClick={send}
          >
            {isBusy
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
              : <><Layers className="w-4 h-4" /> Send Batch</>}
          </Button>

          {isConnected && validationErr && !isBusy && (
            <p className="text-xs text-muted-foreground text-center">{validationErr}</p>
          )}

          {!isConnected && (
            <p className="text-xs text-muted-foreground text-center">Connect your wallet to continue.</p>
          )}
        </div>
      </div>

      {/* Progress / result */}
      {status.phase !== "idle" && (
        <Card className={`p-5 border ${
          status.phase === "done"  ? "border-emerald-500/30 bg-emerald-500/5" :
          status.phase === "error" ? "border-destructive/30 bg-destructive/5" :
          "border-border bg-muted/10"
        }`}>
          <div className="space-y-3">
            <p className={`font-medium text-sm ${
              status.phase === "done"    ? "text-emerald-400" :
              status.phase === "error"   ? "text-destructive" :
              "text-foreground"
            }`}>
              {status.phase === "running" && "Sending batch…"}
              {status.phase === "done"    && "Batch complete!"}
              {status.phase === "error"   && "Failed"}
            </p>

            {/* Step list */}
            {"steps" in status && status.steps.length > 0 && (
              <ol className="space-y-2">
                {status.steps.map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 shrink-0">
                      {step.state === "done"    && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
                      {step.state === "error"   && <XCircle      className="w-4 h-4 text-destructive" />}
                      {step.state === "active"  && <Loader2      className="w-4 h-4 text-primary animate-spin" />}
                      {step.state === "pending" && <Circle       className="w-4 h-4 text-muted-foreground/40" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className={step.state === "pending" ? "text-muted-foreground" : "text-foreground"}>
                        {step.label}
                      </span>
                      {step.txHash && (
                        <a
                          href={`https://testnet.arcscan.app/tx/${step.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-mono text-primary hover:underline mt-0.5"
                        >
                          {step.txHash.slice(0, 18)}…{step.txHash.slice(-6)}
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      )}
                      {step.error && (
                        <p className="text-xs text-destructive/80 mt-0.5">{step.error}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {(status.phase === "done" || status.phase === "error") && (
              <button
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground mt-1"
                onClick={() => setStatus({ phase: "idle" })}
              >
                {status.phase === "done" ? "Send another batch" : "Dismiss"}
              </button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
