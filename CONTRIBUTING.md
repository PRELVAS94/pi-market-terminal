# Contributing

Keep the extension focused on a second-screen market-monitoring workflow. Report a concrete reproduction, expected/actual behavior, OS, terminal, Pi version and relevant source/player status. Avoid including credentials, holdings or private account data.

For code changes:

```sh
npm ci --ignore-scripts
npm run check
npm test
```

For graphics changes on local macOS/Kitty, also run `npm run test:kitty`, then test picture placement, sound, pause, resize and close on screen. Report exactly which checks ran; decoder output alone does not prove successful terminal display.

Use fixtures for normal tests. Keep optional live-network and graphics tests separate. Preserve failure isolation, timestamps, source attribution, provider cooldowns and process cleanup. Do not add model calls to polling or claim streaming, complete calendar coverage or native frame rates without evidence.

Open a focused pull request explaining the problem, behavior change and validation. New providers should identify provenance, freshness, failure behavior and any key/setup requirements. Do not add credential values, session files, generated caches or machine-specific paths.
