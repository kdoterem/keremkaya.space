import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/posts";
import { getProvenanceTags, computeWeights, playableSlugsForTag } from "@/lib/tagProvenance";
import { findCategoryForTag } from "@/lib/playData";
import PlayScreen from "@/app/components/PlayScreen";

export default async function PlaySlugPage({
  params,
}: {
  params: Promise<{ tag: string; slug: string }>;
}) {
  const { tag: rawTag, slug } = await params;
  const tag = decodeURIComponent(rawTag);

  const category = findCategoryForTag(tag);
  if (!category) notFound();

  // Only real, spanned provenance for THIS tag makes a (poem, tag) pair a
  // valid PLAY doorway — same check /play/[tag] used to list it in the
  // first place, re-checked here so a stale/typed-in URL can't open a
  // poem this tag doesn't actually anchor to.
  if (!playableSlugsForTag(tag).includes(slug)) notFound();

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

  return (
    <PlayScreen
      slug={slug}
      tag={tag}
      categoryTitle={category.title}
      title={post.title}
      titleWeights={titleWeights}
      body={bodyText}
      bodyWeights={bodyWeights}
    />
  );
}
