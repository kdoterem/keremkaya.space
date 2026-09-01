import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/posts";
import { getProvenanceTags, computeWeights, playableSlugsForTag } from "@/lib/tagProvenance";
import { findCategoryForTag } from "@/lib/playData";
import { findGateway } from "@/lib/playGateways";
import { splitPoemLines, groupLegiblePassages } from "@/lib/playLines";
import PlayScreen from "@/app/components/PlayScreen";

export default async function PlaySlugPage({
  params,
}: {
  params: Promise<{ gateway: string; tag: string; slug: string }>;
}) {
  const { gateway: gatewayKey, tag: rawTag, slug } = await params;
  const gateway = findGateway(gatewayKey);
  if (!gateway) notFound();

  const tag = decodeURIComponent(rawTag);

  const category = findCategoryForTag(tag);
  if (!category) notFound();

  // Only real, spanned provenance for THIS tag, matching THIS gateway's
  // mode, makes a (poem, tag) pair a valid doorway here — re-checked so
  // a stale/typed-in URL (or the wrong gateway for this poem's actual
  // mode) can't open something that doesn't belong to it.
  if (!playableSlugsForTag(tag, gateway.mode).includes(slug)) notFound();

  const post = getPostBySlug(slug);
  if (!post) notFound();

  const provenanceTags = getProvenanceTags(slug) ?? {};
  // Filtered down to just this one tag before weighting — the whole point
  // of this screen is that only THIS tag's spans are legible, not every
  // tag the poem happens to carry. Guarded rather than assumed: the
  // playableSlugsForTag check above should already guarantee this entry
  // exists, but computeWeights would throw on an undefined entry rather
  // than degrade, so this stays defensive instead of trusting the guard
  // twice.
  const singleTag = provenanceTags[tag] ? { [tag]: provenanceTags[tag] } : {};

  const bodyText     = post.content.trim();
  const titleWeights = computeWeights(post.title, singleTag);
  // singleTag is always a real (possibly empty) object, never undefined,
  // so computeWeights never actually returns undefined here — the `?? []`
  // just satisfies its general signature.
  const primaryWeights = computeWeights(bodyText, singleTag) ?? [];

  // Cluster-merging: a single argument often runs across several tags on
  // the same poem (see the-dictator/god — the full fatalism argument
  // ["if we know our history, would we know our future? ... it's
  // pre-owned"] is spread across doubt/truth/control/god spans, one
  // clause each). Isolating just the entered tag's own spans reduces a
  // whole argument to one fragmentary line — technically honest, but not
  // an argument anymore. Fix: compute weights from EVERY tag this post
  // carries, group THAT combined view into passages, and for any passage
  // this tag's own span actually touches, bring the rest of that passage
  // along too — marked -1 ("borrowed context"), never this tag's own
  // weight, so the write-prompt and alive motion still anchor only to
  // the tag's real span while the surrounding argument stays legible
  // instead of vanishing.
  const combinedWeights = computeWeights(bodyText, provenanceTags);
  const combinedLines = splitPoemLines(bodyText, combinedWeights);
  const combinedPassages = groupLegiblePassages(combinedLines);

  const bodyWeights = bodyText.split("").map((_, i) => (primaryWeights[i] > 0 ? primaryWeights[i] : 0));
  for (const passage of combinedPassages) {
    const touchesPrimary = passage.lines.some((line) =>
      primaryWeights.slice(line.start, line.end).some((w) => w > 0),
    );
    if (!touchesPrimary) continue;
    for (const line of passage.lines) {
      for (let i = line.start; i < line.end; i++) {
        if (bodyWeights[i] === 0) bodyWeights[i] = -1;
      }
    }
  }

  // One consistent prompt for the whole screen — the gateway already
  // decided this, so there's nothing left to ask per passage.
  const promptLabel = gateway.mode === "argue" ? "push back" : "write here";

  return (
    <PlayScreen
      slug={slug}
      tag={tag}
      categoryTitle={category.title}
      title={post.title}
      titleWeights={titleWeights}
      body={bodyText}
      bodyWeights={bodyWeights}
      promptLabel={promptLabel}
      backHref={`/play/${gateway.key}/${encodeURIComponent(tag)}`}
    />
  );
}
