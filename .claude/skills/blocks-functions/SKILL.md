---
name: blocks-functions
description: "Serverless Node functions on Blocks Logic: write the handler (index.js + package.json), save/test/deploy with `blocks logic function *`, then call it from app code with the SDK's `blocksClient.logic.functions.call()/invoke()` or from a workflow `function` step. Covers triggers (HTTP methods, Public vs Token, sync vs async), variables and `{{secret.<id>}}` references, runs/logs/replay, and the fixed 30 s / 128 MB limits. Use for custom backend code an app or webhook calls, not for event graphs (blocks-workflow) or third-party API passthrough (blocks-proxy)."
---

# blocks-functions

This skill's content lives at [`.agents/skills/blocks-functions/SKILL.md`](../../../.agents/skills/blocks-functions/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so this agent discovers the skill. It holds no guidance of its own and must never be given any — the `.agents` copy is the single source of truth, and a second copy would drift.
