// ── The two gateways into PLAY — chosen once, up front, at /play. Every-
// thing downstream (which categories have anything in them, which tags,
// which poems, and the single prompt language on the play screen itself)
// is scoped to whichever one was picked. No fs/posts import here
// deliberately — this needs to be safe to import from a client component
// (app/play/saved/page.tsx, to work out which gateway a saved writing
// belongs to) as well as every server route under /play.
export interface PlayGateway {
  key:   string;
  title: string;
  blurb: string;
  mode:  "outpour" | "argue";
}

export const PLAY_GATEWAYS: PlayGateway[] = [
  {
    key:   "push-back",
    title: "push back",
    blurb: "meet a claim, head on.",
    mode:  "argue",
  },
  {
    key:   "paint-a-picture",
    title: "paint a picture",
    blurb: "follow an image, wherever it leads.",
    mode:  "outpour",
  },
];

export function findGateway(key: string): PlayGateway | undefined {
  return PLAY_GATEWAYS.find((g) => g.key === key);
}

export function gatewayForMode(mode: "outpour" | "argue" | undefined): PlayGateway | undefined {
  return PLAY_GATEWAYS.find((g) => g.mode === mode);
}
