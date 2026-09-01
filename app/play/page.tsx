import Link from "next/link";
import { PLAY_GATEWAYS } from "@/lib/playGateways";

// ── PLAY's entry point — the one choice everything downstream depends
// on. Not "pick a category" first anymore: which of Kerem's marked
// thoughts even show up at all is scoped to whichever gateway gets
// picked here, since a piece only ever belongs to the one gateway
// matching its own provenance mode. Categories, tags, and poems all live
// one level in, under /play/[gateway].
export default function PlayGatewayPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        backgroundColor: "#aaff00",
        color: "#0a0a0a",
        fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
        padding: "4rem 5vw 6rem",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Link
          href="/"
          style={{
            fontSize: "0.7rem",
            fontWeight: 500,
            letterSpacing: "0.15em",
            fontVariant: "small-caps",
            color: "#0a0a0a",
            textDecoration: "none",
            opacity: 0.5,
          }}
        >
          RETURN
        </Link>
        <Link
          href="/play/saved"
          style={{
            fontSize: "0.7rem",
            fontWeight: 500,
            letterSpacing: "0.1em",
            fontVariant: "small-caps",
            color: "#0a0a0a",
            textDecoration: "none",
            opacity: 0.5,
          }}
        >
          your saved writings →
        </Link>
      </div>

      <div style={{ maxWidth: "680px", margin: "0 auto", marginTop: "3.5rem" }}>
        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            marginBottom: "1rem",
          }}
        >
          PLAY
        </h1>
        <p
          style={{
            fontSize: "0.95rem",
            lineHeight: 1.6,
            color: "rgba(10,10,10,0.55)",
            maxWidth: "42em",
            marginBottom: "3rem",
          }}
        >
          you'll see only what a thought marks in one piece of mine, everything else kept
          illegible. write your own before you look at mine. not a quiz — just two people
          who happened to land on the same thought, checking each other's work.
        </p>

        <p
          style={{
            fontSize: "0.65rem",
            fontWeight: 500,
            letterSpacing: "0.14em",
            fontVariant: "small-caps",
            color: "rgba(10,10,10,0.45)",
            marginBottom: "1rem",
          }}
        >
          which door?
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {PLAY_GATEWAYS.map((gateway) => (
            <Link
              key={gateway.key}
              href={`/play/${gateway.key}`}
              style={{
                display: "block",
                padding: "1.4rem 1.5rem",
                border: "1px solid rgba(10,10,10,0.25)",
                borderRadius: "6px",
                textDecoration: "none",
                color: "#0a0a0a",
              }}
            >
              <span style={{ display: "block", fontSize: "1.3rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
                {gateway.title}
              </span>
              <span style={{ display: "block", fontSize: "0.85rem", fontStyle: "italic", color: "rgba(10,10,10,0.5)", marginTop: "0.25rem" }}>
                {gateway.blurb}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
