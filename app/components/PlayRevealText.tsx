"use client";

import ObscurableToken from "./ObscurableToken";
import { wordWeightLevel } from "./InvisibleInkText";

// ── Word-level rendering for the title — the only thing this needs to
// decide per word is its weight, for the alive-motion treatment. Nothing
// in the title is ever obscured (see PlayScreen's header comment for
// why — it's the reader's orientation for what they're looking at, not
// part of the guessing), so there's no reveal state to track here.
export default function PlayRevealText({
  text,
  weights,
  style,
  className,
}: {
  text: string;
  weights: number[] | undefined;
  style?: React.CSSProperties;
  className?: string;
}) {
  const tokens = text.split(/(\s+)/);
  let offset = 0;

  return (
    <span className={className} style={{ whiteSpace: "pre-wrap", ...style }}>
      {tokens.map((tok, i) => {
        const start = offset;
        offset += tok.length;
        if (!tok || /^\s+$/.test(tok)) return <span key={i}>{tok}</span>;
        const weight = weights ? wordWeightLevel(weights, start, tok.length) : 0;
        return <ObscurableToken key={i} text={tok} weight={weight} seed={start} />;
      })}
    </span>
  );
}
