# Architecture

| Module                  | Responsibility                                                         |
| ----------------------- | ---------------------------------------------------------------------- |
| `index.ts`              | Extension registration, quote/news tools, provider requests and caches |
| `terminal-config.ts`    | Session-persisted settings, validation and setting commands            |
| `market-service.ts`     | Shared per-process subscriptions, scheduling, backoff and health       |
| `terminal.ts`           | Dashboard state, keyboard navigation and view/player lifecycle         |
| `market-layout.ts`      | Width-bounded grid/stack/expanded terminal rendering                   |
| `instrument-history.ts` | On-demand daily chart series, parsing and cache                        |
| `calendar.ts`           | BLS ICS calendar and local-time conversion                             |
| `article-reader.ts`     | Supported public article extraction and publisher Key Points           |
| `embedded-player.ts`    | Local Kitty/mpv shared-memory bridge and private JSON IPC              |
| `terminal-video.ts`     | Portable FFmpeg PNG/character preview                                  |
| `quality-player.ts`     | Separate maximum-source-quality mpv window                             |

Opening the dashboard subscribes to quote/news resources. Consumers share requests within one Pi process. Animation uses cached data; it does not poll. Failed sources retain usable data and expose health diagnostics. Closing the view releases subscriptions and stops timers, fetches and launched players.

History and article requests are on-demand and bounded. News, calendar and quote timestamps remain separate from receipt time. The view never labels a missing daily change as zero.

The embedded player captures mpv stdout and rejects everything except bounded shared-memory graphics packets. POSIX shared-memory names are normalized to begin with `/`; mpv 0.41 on macOS otherwise emits a name rejected by Kitty 0.49. Outgoing frames receive an owned image ID, safe pane coordinates and no terminal-wide clear commands. Placement-only redraws avoid replaying a memory name that Kitty already unlinked. JSON IPC uses an inherited local pipe rather than a publicly accessible socket.

Normal tests use fixtures and mock subprocesses. `npm run test:kitty` generates a local 1080p clip and sends real mpv output into Kitty's native parser. This check validates frame storage and graphics responses, not GPU presentation or audible sound. On-screen acceptance remains a separate step.
