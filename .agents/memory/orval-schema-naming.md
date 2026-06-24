---
name: Orval Zod schema naming collision
description: Orval generates both a Zod schema (in api.ts) and a TypeScript interface (in types/) using the same name when a component schema name matches the operationId-derived body name.
---

Orval generates TWO outputs per endpoint:
1. `api.ts` — Zod schema named `<OperationIdPascal>Body` (e.g. `X402SendBody` from operationId `x402Send`)
2. `types/<schemaName>.ts` — TypeScript interface named after the `$ref` schema (e.g. `X402SendBody` from schema `X402SendBody`)

When both names are identical, `lib/api-zod/src/index.ts` (which does `export * from "./generated/api"` and `export * from "./generated/types"`) fails with TS2308 duplicate export.

**Why:** The Zod validator for a request body is named from the operationId, not the schema ref. Existing schemas avoid this because their `$ref` schema names differ from the operationId+Body pattern (e.g. `EscrowInput` vs `CreateEscrowBody`).

**How to apply:** Name component schemas differently from the operationId+Body pattern. For example, if operationId is `x402Send`, name the schema `X402TransferAuth` (not `X402SendBody`) so the TypeScript interface (`X402TransferAuth`) doesn't collide with the Zod schema (`X402SendBody`).
