---
name: blocks-proxy
description: "Call a third-party API from app code without shipping its URL or keys: configure a Blocks Logic proxy with `blocks logic proxy *` (upstream, declared routes, injected headers with `{{$VAR.name}}` secrets, who-can-call access, timeout/retry/circuit breaker, rate limit, OpenAPI import), then call it with the SDK's `blocksClient.logic.proxy.request()`. Also covers testing, version history/revert and request logs. Use for credentialed upstream passthrough; custom code belongs in blocks-functions, event graphs in blocks-workflow."
---

# blocks-proxy

This skill's content lives at [`.agents/skills/blocks-proxy/SKILL.md`](../../../.agents/skills/blocks-proxy/SKILL.md).

**Read that file now and follow it.** Its relative links (`flows/`, sibling files) resolve from that directory, not this one.

This stub exists so this agent discovers the skill. It holds no guidance of its own and must never be given any — the `.agents` copy is the single source of truth, and a second copy would drift.
