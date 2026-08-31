"use client";

import ObscurableToken from "./ObscurableToken";
import { wordWeightLevel } from "./InvisibleInkText";

// ── Word-level obscure/reveal for a single line of text (used for the
// title, which never gets its own write-zone — see PlayPoemBody for the
// body, which additionally interleaves those). Tokenizing by word here,
// not by contiguous weight-run, is what keeps this correct regardless of
// how the text wraps — see ObscurableToken's header comment for why.
export default function PlayRevealText({
  text,
  weights,
  revealed,
  style,
  className,
}: {
  text: string;
  weights: number[] | undefined;
  revealed: boolean;
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
        return <ObscurableToken key={i} text={tok} weight={weight} revealed={revealed} seed={start} />;
      })}
    </span>
  );
}
