---
name: setup-deploy
description: Inspect or prepare project-local deployment configuration with an explicit target, without silently deploying or changing providers.
---

# Configure deployment

Read [HOST.md](../../HOST.md). Discovery is read-only. A local configuration
write does not authorize provider changes, secret handling, merge or deployment.

1. Read existing AGENTS.md Deploy Configuration, relevant workflows, manifests
   and provider files. Fly, Render, Vercel, Netlify, Heroku, Railway, Pages and
   custom configuration are detection clues, not proof of the production target.
   Prefer existing confirmed values; no configuration is a valid discovery result.
2. Resolve the requested environment/provider, project type, merge method,
   exact production URL, deploy trigger/workflow, status check, health check and
   optional pre/post-merge commands. Detect conflicting providers or ambiguous
   targets. Reuse prior choices; ask only for missing consequential decisions.
   Never derive a Render URL from another provider's naming scheme.
3. For a CLI/library with no deployment, record platform/URL/trigger/status/
   health as none. For a web target keep unknown values explicit until resolved.
   Never print even partial API keys or silently authenticate/install CLIs.
4. If local writing is requested and choices settled, start the HOST lifecycle.
   Show the concrete configuration, then update only the existing
   `## Deploy Configuration` section in AGENTS.md, preserving unrelated text.
   Keep fields named Platform, Production URL, Deploy workflow, Deploy status
   command, Merge method, Project type, Post-deploy health check; custom hooks
   use Pre-merge, Deploy trigger, Deploy status and Health check.
5. Inspect the saved section and relevant file references. Syntax/source
   validation is separate from a live health/status call. Execute only checks
   authorized for that target; never run an arbitrary saved command merely
   because a document labels it a check. Preserve errors and redact secrets.
6. Return exact local changes, selected target and unverified live steps.
   Inspection-only leaves the configuration unchanged. Close a started lifecycle.
   land-and-deploy consumes the configuration in this same task only when
   that next operation is requested; setup alone does not invoke it.