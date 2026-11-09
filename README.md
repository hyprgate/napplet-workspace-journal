<!-- HYPRGATE NAPPLET MIRROR NOTICE:START -->
> This repository is a read-only mirror of the `workspace-journal` napplet from `hyprgate/gui`.
> Open issues and pull requests in https://github.com/hyprgate/gui.
> Do not push commits to this standalone napplet repository; direct changes are overwritten by Hyprgate's mirror workflow.
<!-- HYPRGATE NAPPLET MIRROR NOTICE:END -->

# Workspace Journal

Keep timestamped notes about what you're doing, with links to the notes, people and
relays involved. Entries live in the app's own shell-mediated storage. Other apps can
also send entries over the `journal:capture` INC topic.

The source lives in the Hyprgate monorepo at `napplets/workspace-journal`. The standalone
`hyprgate/napplet-workspace-journal` repository is a generated, read-only mirror, so send
changes to [hyprgate/web](https://github.com/hyprgate/web).

## Developing

Run these from the root of a Hyprgate checkout so workspace dependencies resolve:

```bash
pnpm install --frozen-lockfile
pnpm --filter ./napplets/workspace-journal paja        # Kehto Paja plus the Vite dev server
pnpm --filter ./napplets/workspace-journal test
pnpm --filter ./napplets/workspace-journal type-check
pnpm --filter ./napplets/workspace-journal conformance # builds, then checks dist/
```

Forms never submit under the `allow-scripts` sandbox, so use a button `onclick` and
handle Enter on the input.
