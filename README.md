# napplet-workspace-journal

Forkable source repository for the Hyprgate built-in napplet currently packaged as `@hyprgate/napp-workspace-journal`.

This repository was split from `hyprgate/gui` and is mounted back into the parent checkout as `napplets/workspace-journal`.
It still expects the parent workspace when built through Hyprgate because shared `@hyprgate/*` packages remain workspace dependencies.

## Parent checkout

```bash
git clone --recurse-submodules git@github.com:hyprgate/gui.git
cd gui
pnpm install --frozen-lockfile
pnpm --filter @hyprgate/napp-workspace-journal build
```
