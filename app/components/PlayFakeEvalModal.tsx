"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import CryptoScramble from "./CryptoScramble";
import DodgeCommitButton from "./DodgeCommitButton";
import ConfettiCanvas from "./ConfettiCanvas";

// ── The ceremony after a reader submits a passage — deliberately not a
// real evaluation, because there's no honest way to auto-grade someone's
// writing against Kerem's own poem (the same reasoning that kept the
// passage-selection and provenance data honest rather than forced: no
// score here would be real either). What this IS instead:
//
//  1. A brief "evaluating" beat — CryptoScramble run in infinite mode
//     (never resolves, just keeps churning) for a couple seconds. Not a
//     spinner: the site already has a text-scramble vocabulary from the
//     reading modes, so borrowing it here reads as one more piece of the
//     same language instead of a generic loading indicator. The reader's
//     own writing is never shown in this modal — the point is "not having
//     control," not a review screen.
//  2. A quick, quiet "proceed" state (a small tick, not confetti — that
//     cost is saved for the one thing actually worth celebrating).
//  3. Underneath, small and unhighlighted on purpose: "send this to
//     kerem" — a real send (Web3Forms, same pattern as /kismet), gated by
//     DodgeCommitButton so it takes a genuine second tap. On success the
//     label itself becomes the reward: "kerem appreciates it," plus the
//     confetti this moment earns and the ceremony above doesn't.
const EVAL_MS = 1800;
const EVAL_PLACEHOLDER = "reading this closely"; // length is all that matters — never resolves to it

const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY = "1bf57100-9d1e-4357-9747-7155c3a32255";

type SendState = "idle" | "sending" | "sent" | "error";

function buildMessage(passageLines: string[], written: string): string {
  return `${passageLines.join("\n")}\n\n—\n\n${written}`;
}

export default function PlayFakeEvalModal({
  open,
  passageLines,
  written,
  onProceed,
}: {
  open: boolean;
  passageLines: string[];
  written: string;
  onProceed: () => void;
}) {
  const [phase, setPhase] = useState<"evaluating" | "proceed">("evaluating");
  const [sendState, setSendState] = useState<SendState>("idle");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    setPhase("evaluating");
    setSendState("idle");
    const t = setTimeout(() => setPhase("proceed"), EVAL_MS);
    return () => clearTimeout(t);
  }, [open]);

  const handleSend = useCallback(async () => {
    if (sendState === "sending" || sendState === "sent") return;
    setSendState("sending");
    try {
      const res = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_key: WEB3FORMS_ACCESS_KEY,
          from_name: "PLAY",
          subject: "PLAY — a passage answered",
          message: buildMessage(passageLines, written),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error("send failed");
      setSendState("sent");
    } catch {
      setSendState("error");
    }
  }, [passageLines, written, sendState]);

  const sendLabel =
    sendState === "sent" ? "kerem appreciates it" :
    sendState === "sending" ? "sending…" :
    sendState === "error" ? "couldn't send — try again" :
    "send this to kerem";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 300,
            background: "#aaff00",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
          }}
        >
          {phase === "evaluating" && (
            <CryptoScramble
              text={EVAL_PLACEHOLDER}
              infinite
              tickMs={45}
              style={{
                fontSize: "clamp(1.1rem, 3.5vw, 1.6rem)",
                fontWeight: 500,
                letterSpacing: "0.02em",
                color: "#0a0a0a",
              }}
            />
          )}

          {phase === "proceed" && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2rem" }}
            >
              {/* A quick tick — receipt energy, not a celebration. */}
              <motion.svg
                width="48" height="48" viewBox="0 0 48 48" aria-hidden="true"
                initial={{ scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                <circle cx="24" cy="24" r="22" fill="none" stroke="#0a0a0a" strokeWidth="2" />
                <motion.path
                  d="M14 24.5 L20.5 31 L34 16"
                  fill="none"
                  stroke="#0a0a0a"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.35, delay: 0.15, ease: "easeOut" }}
                />
              </motion.svg>

              <button
                onClick={onProceed}
                className="export-btn"
              >
                proceed
              </button>

              <DodgeCommitButton
                label={sendLabel}
                armedLabel="send it →"
                onCommit={handleSend}
                disabled={sendState === "sending" || sendState === "sent"}
              />
            </motion.div>
          )}

          {sendState === "sent" && !reduceMotion && <ConfettiCanvas durationMs={3000} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
