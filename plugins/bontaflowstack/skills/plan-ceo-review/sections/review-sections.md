# Product and scope review dimensions

- Problem and audience: observed demand versus assumptions; current workaround;
  smallest useful outcome and how success will be seen.
- Scope: accepted requirements, deferred ideas, existing capabilities, value
  versus effort, reversibility and long-term direction.
- Architecture/data: boundaries, normal/empty/missing/error paths, state
  transitions, dependencies, ownership and realistic failure recovery.
- Security: input, authorization, secrets, unsafe external effects and data loss.
- Delivery: maintainability, meaningful tests, performance based on evidence,
  observability, rollout/rollback and operational ownership.
- UI when relevant: primary journey, error/empty states, mobile and accessibility.

A short scope review may report only the material gaps. A requested deep
review can expand each dimension, include an error/rescue map, implementation
tasks with dependencies and targeted diagrams. Use an available user-selected
diagram skill such as archify for a rendered diagram. No forced scope expansion,
new infrastructure, per-issue approval ritual or second model.
