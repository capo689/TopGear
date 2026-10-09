# Contributing

Thanks for helping. Bug reports, especially from **extension mode** in a real Chrome, are
the most useful contribution right now.

## Reporting a bug

Open an [issue](https://github.com/capo689/TopGear/issues/new/choose) and include:

- your OS, Node version, Chrome version (for extension mode), and MCP client
- the output of `pnpm doctor`
- what you asked the agent to do, and the tool result or error it got
- the MCP server's stderr (Claude Desktop on macOS: `~/Library/Logs/Claude/mcp*.log`)

Leave out passwords, cookies and form values. A site's domain is enough.

## Making a change

```bash
pnpm bootstrap      # install, build, Chromium, smoke test
pnpm typecheck
pnpm test           # unit + real-Chromium suites
pnpm smoke          # the built MCP server, end to end
```

Before you open a pull request:

- Keep changes focused, and add or update tests for the behaviour you change.
- `pnpm build`, `pnpm typecheck` and `pnpm test` must pass. CI runs the same commands.
- Cross-boundary types live only in `packages/protocol`, and every boundary validates its
  input with Zod.
- Safety rules are not negotiable: page content is untrusted, high-risk actions always need
  a confirmation that the daemon builds, and secrets never enter model context, logs or
  errors. The full list (INV-1..INV-11) is in
  [docs/engineering/STANDING_LAW.md](docs/engineering/STANDING_LAW.md). A change that trades
  safety for speed will be declined.
- New dependencies need a reason in the PR description. Install scripts are blocked by
  default (`pnpm.onlyBuiltDependencies` in `package.json`).

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE).
