import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/posts";
import { getProvenanceTags, computeWeights, playableSlugsForTag } from "@/lib/tagProvenance";
import { findCategoryForTag } from "@/lib/playData";
import { findGateway } from "@/lib/playGateways";
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
  const bodyWeights  = computeWeights(bodyText, singleTag);

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
