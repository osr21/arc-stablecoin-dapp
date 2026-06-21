---
name: PayrollVesting token whitelist
description: PayrollVesting.sol had no token whitelist; one was added matching ConditionalEscrow's pattern but requires redeployment to take effect
---

The deployed `PayrollVesting` at `0x9b96be4a489656b01d2922b1bea9c932ed258215` (Arc Testnet) does NOT have the token whitelist — it accepts any ERC-20 token address.

The fix was added to `contracts/src/PayrollVesting.sol`:
- `mapping(address => bool) public allowedTokens` in the struct area
- Constructor populates USDC (`0x3600...0000`) and EURC (`0x89B5...D72a`)
- `require(allowedTokens[token], "Token not allowed: use USDC or EURC")` at top of `createSchedule()`

**Why:** Without the whitelist, a malicious employer could pass a fake ERC-20 address, appearing to create a funded schedule that actually holds nothing. ConditionalEscrow already had this whitelist; PayrollVesting was inconsistent.

**How to apply:** Redeploy PayrollVesting with the forge script in replit.md, then update the deployed address in replit.md and any frontend/API constants that reference it.
