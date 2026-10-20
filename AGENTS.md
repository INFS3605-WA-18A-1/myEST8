## Git workflow

`master` is production. Every push to it runs CI, applies the Supabase migrations to the production database and deploys to Vercel (`.github/workflows/ci.yml`, `docs/vercel.md`). `dev` is where finished work comes together and gets checked before it goes to `master`.

```
your branch ──PR──▶ dev ──release PR──▶ master (deploys to production)
```

### Branches

- Start every change on a new branch cut from the latest `dev`: `git switch dev && git pull && git switch -c <name>`.
- Name the branch for the change in short kebab-case (`dashboard-redesign`, `fix-backup-workflow`). If there is a `.scratch/<feature>/` issue, use its feature slug.
- One feature or fix per branch. Never commit straight to `dev` or `master`.
- Agents working beside other sessions use a git worktree, so they don't switch branches under someone else.

### Keeping a branch up to date

- When `dev` moves on, or before you open a PR, merge it into your branch: `git fetch && git merge origin/dev`. Resolve any conflicts on your branch, then run the checks again.
- Don't rebase or force-push a branch someone else has pulled.
- If two people changed the same thing (for example, both redesigned one page), talk before resolving it. Don't silently pick a side.

### Pull requests

- **The base branch is always `dev`.** GitHub offers `master` by default, so change it, or use `gh pr create --base dev`. A PR opened against `master` gets retargeted to `dev` (hotfixes and release PRs are the only exceptions).
- Before you open it:
  - `npm run check` passes (typecheck, unit and end-to-end tests).
  - If you changed Tailwind classes, run `npm run css` and commit `src/web/static/tw.css`.
  - If the design or the domain language changed, update `docs/design-system.md`, `CONTEXT.md` or an ADR in `docs/adr/`.
- Title: what the change does, in sentence case ("Redesign the dashboard"). Body: what changed and why, how you tested it, screenshots for UI changes, and a link to the `.scratch` issue if there is one.
- Another teammate reviews it, and CI's `test` check must be green before it is merged.
- Merge with **Create a merge commit**, then delete the branch.
- Agents open PRs but don't merge them unless the user asks.

### Releasing `dev` to `master`

- First push `dev` to the QA environment on the home server (`git push origin dev:qa`) and let the **QA** workflow go green: it sends a real email through Gmail and Resend and checks the app answers (`docs/qa.md`, ADR 0011). Agents don't push to `qa` unless asked, because a push sends real email.
- Open a PR from `dev` to `master`. Before merging, a human looks over `dev` as a whole: read the diff, and run the app with `npm run demo`.
- Merge it with **Create a merge commit**, never squash or rebase. Squashing gives `master` commits that `dev` doesn't have, and then every later release conflicts.
- Merging deploys to production and migrates its database. Do it when someone can watch the CI `deploy-prod` and `smoke` jobs. If something breaks, roll back with the Rollback workflow (`docs/vercel.md`).
- Agents never merge into `master`. They stop once the release PR is open.

### Hotfixes

For an urgent production fix, branch from `master` and open the PR into `master`. Once it is merged, merge `master` back into `dev` straight away so the two don't drift apart.

### Dependabot

Dependabot opens its PRs against `master`. Retarget each one to `dev` (`gh pr edit <n> --base dev`) and treat it like any other PR.

### Commits

Keep commits small and focused. Write a summary line in sentence case that says what the commit does (about 72 characters at most), then a blank line, then a body that explains why.

## Agent skills

### Issue tracker

Issues are tracked as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.
