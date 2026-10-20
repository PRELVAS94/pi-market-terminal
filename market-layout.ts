import {
  truncateToWidth,
  visibleWidth,
  stripTerminalSequences,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export type MarketRow = {
  id: string;
  label: string;
  detail: string[];
  color?: string;
  parts?: { text: string; color: string }[];
  subtitle?: string;
};
export type MarketPane = {
  title: string;
  caption?: string;
  rows: MarketRow[];
  empty: string;
  selected: number;
  details?: string[];
  detailOffset?: number;
  wrap?: boolean;
  pixels?: string[];
};
export const safeText = (text: unknown) =>
  stripTerminalSequences(String(text ?? "")).replace(
    /[\x00-\x1f\x7f-\x9f]/g,
    " ",
  );
export function marketGeometry(width: number, height: number) {
  const body = Math.max(0, height - 3);
  if (width < 80 || height < 21) return undefined;
  if (width >= 100) {
    const left = Math.floor((width - 1) * 0.44),
      right = width - left - 1;
    const top = Math.ceil((body - 1) * 0.58),
      bottom = body - top - 1;
    return {
      grid: true,
      panes: [
        { width: left, height: top },
        { width: right, height: top },
        { width: left, height: bottom },
        { width: right, height: bottom },
      ],
    };
  }
  const available = body - 3,
    base = Math.floor(available / 4),
    extra = available % 4;
  return {
    grid: false,
    panes: Array.from({ length: 4 }, (_, i) => ({
      width,
      height: base + (i < extra ? 1 : 0),
    })),
  };
}
export function detailLines(details: string[], width: number) {
  return details.flatMap((line) =>
    wrapTextWithAnsi(safeText(line), Math.max(1, width - 4)),
  );
}
export function renderMarketDashboard(input: {
  width: number;
  height: number;
  title: string;
  status: string;
  panes: MarketPane[];
  focus: number;
  help: string;
  helpMode?: boolean;
  ticker?: string;
  expanded?: number;
  fg: (color: string, text: string) => string;
}) {
  const width = Math.max(0, Math.floor(input.width)),
    height = Math.max(1, Math.floor(input.height));
  const fit = (text: string, w = width) => {
    const clipped = truncateToWidth(text, Math.max(0, w));
    return clipped + " ".repeat(Math.max(0, w - visibleWidth(clipped)));
  };
  const contentHeight = height - (input.ticker ? 1 : 0);
  const layout = marketGeometry(width, contentHeight);
  const expanded =
    input.expanded !== undefined && input.expanded >= 0 && input.expanded < 4
      ? input.expanded
      : undefined;
  if (!layout) {
    const text = [
      input.title,
      "Resize to at least 80 columns × 24 terminal rows to show all four panes.",
      input.status,
      input.help,
    ];
    return Array.from({ length: height }, (_, i) => fit(text[i] ?? ""));
  }
  const panel = (pane: MarketPane, index: number) => {
    const { width: w, height: h } =
        expanded === index
          ? { width, height: contentHeight - 3 }
          : layout.panes[index],
      inner = w - 2,
      budget = h - 2;
    const total = pane.rows.length,
      selected = Math.max(0, Math.min(pane.selected, Math.max(0, total - 1)));
    const title = ` ${index + 1} ${pane.title}${input.focus === index ? " *" : ""}${pane.details ? " DETAILS" : ""} ${total ? `${selected + 1}/${total}` : "0"} `;
    const heading = truncateToWidth(title, inner);
    const active = input.focus === index;
    const border =
      (active ? "┏" : "┌") +
      heading +
      (active ? "━" : "─").repeat(Math.max(0, inner - visibleWidth(heading))) +
      (active ? "┓" : "┐");
    const lines = [input.fg(input.focus === index ? "accent" : "dim", border)];
    const body: string[] = [];
    if (pane.details) {
      const wrapped = detailLines(pane.details, w),
        offset = Math.min(
          pane.detailOffset ?? 0,
          Math.max(0, wrapped.length - 1),
        );
      for (const line of wrapped.slice(offset, offset + budget))
        body.push(" " + line);
    } else {
      if (pane.caption && budget > 1)
        body.push(
          input.fg("dim", truncateToWidth(safeText(pane.caption), inner)),
        );
      if (pane.pixels?.length)
        body.push(...pane.pixels.slice(0, budget - body.length));
      else if (!total)
        body.push(
          ...wrapTextWithAnsi(safeText(pane.empty), Math.max(1, inner)).slice(
            0,
            budget - body.length,
          ),
        );
      else {
        const start = Math.max(
          0,
          selected - Math.floor(Math.max(0, budget - body.length - 1) / 2),
        );
        for (let i = start; i < total && body.length < budget; i++) {
          const row = pane.rows[i];
          const label = row.parts
              ? row.parts
                  .map((p) => input.fg(p.color, safeText(p.text)))
                  .join("")
              : safeText(row.label),
            prefix =
              i === selected ? (input.focus === index ? "> " : "· ") : "  ";
          const wrapped = pane.wrap
            ? wrapTextWithAnsi(label, Math.max(1, inner - 2)).slice(0, 2)
            : [truncateToWidth(label, Math.max(0, inner - 2))];
          for (let j = 0; j < wrapped.length && body.length < budget; j++)
            body.push(
              input.fg(
                i === selected && active
                  ? "selected"
                  : row.parts
                    ? "text"
                    : (row.color ?? "text"),
                i === selected && active
                  ? fit((j === 0 ? prefix : "  ") + wrapped[j], inner)
                  : (j === 0 ? prefix : "  ") + wrapped[j],
              ),
            );
          if (
            row.subtitle &&
            i === selected &&
            inner >= 50 &&
            body.length < budget
          )
            body.push(
              input.fg(
                "dim",
                "  " + truncateToWidth(safeText(row.subtitle), inner - 2),
              ),
            );
        }
      }
    }
    for (let i = 0; i < budget; i++)
      lines.push(
        input.fg("dim", "│") + fit(body[i] ?? "", inner) + input.fg("dim", "│"),
      );
    lines.push(
      input.fg(
        active ? "accent" : "dim",
        (active ? "┗" : "└") +
          (active ? "━" : "─").repeat(inner) +
          (active ? "┛" : "┘"),
      ),
    );
    return lines;
  };
  if (input.helpMode) {
    const help = [
      "KEYBOARD / MARKET WORKSPACE",
      "",
      "1–4 / Tab   Switch pane       ↑ / ↓     Select or scroll",
      "Enter       Open details     f         Expand / restore pane",
      "/           Search loaded symbols, companies and headlines",
      "w           Edit watchlist   s         Watchlist / gainers / losers",
      "t           Cycle quote polling: 5 / 15 / 60 seconds",
      "v           Terminal TV      g         Separate HD/audio window",
      "m           Mute / unmute    + / −     Adjust TV volume",
      "p           Pause / resume   r         Refresh feeds",
      "h           Source health    o         Open source in browser",
      "Esc         Clear search / back       q         Close workspace",
      "",
      "TV selects the best available source up to 1080p.",
      "The pane scales to fit; source FPS is preserved. Start muted; m enables sound.",
      "Yahoo/RSS may be delayed. Quote polling is not exchange streaming.",
      "Calendar coverage: BLS. Publisher Key Points are not Pi analysis.",
      "",
      "Press ? or Esc to return.",
    ];
    return Array.from({ length: height }, (_, i) =>
      i === 0
        ? input.fg("brand", fit(safeText(input.title)))
        : fit(help[i - 2] ?? ""),
    );
  }
  const blocks = input.panes.map(panel);
  const body: string[] = [];
  if (expanded !== undefined) body.push(...blocks[expanded]);
  else if (layout.grid) {
    for (let i = 0; i < blocks[0].length; i++)
      body.push(blocks[0][i] + " " + blocks[1][i]);
    body.push("");
    for (let i = 0; i < blocks[2].length; i++)
      body.push(blocks[2][i] + " " + blocks[3][i]);
  } else
    blocks.forEach((block, i) => {
      if (i) body.push("");
      body.push(...block);
    });
  const lines = [
    input.fg("brand", fit(safeText(input.title))),
    input.fg("dim", safeText(input.status)),
    ...(input.ticker ? [input.fg("accent", safeText(input.ticker))] : []),
    ...body,
    input.fg("dim", safeText(input.help)),
  ];
  return Array.from({ length: height }, (_, i) => fit(lines[i] ?? ""));
}
