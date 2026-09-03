import PlayNext from "@/app/components/PlayNext";

// ── PLAY's entry point — no longer a choice screen. The old gateway pick
// ("push back" vs "paint a picture") asked the reader to declare an
// intent before they'd seen anything to react to; a passage is just
// served now, off the reader's own difficulty tier, and what they do
// with it is theirs to discover rather than a fork picked in advance.
// See PlayNext.tsx for the actual flow.
export default function PlayPage() {
  return <PlayNext />;
}
