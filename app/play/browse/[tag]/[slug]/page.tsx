import { notFound } from "next/navigation";
import { getPostBySlug } from "@/lib/posts";
import { getProvenanceTags, computeWeights, playableSlugsForTag } from "@/lib/tagProvenance";
import { findCategoryForTag } from "@/lib/playData";
import { splitPoemLines, groupLegiblePassages } from "@/lib/playLines";
import PlayScreen from "@/app/components/PlayScreen";

// Neutral prompt language everywhere now — the "push back" / "write here"
// split was gateway-derived, and the gateway is gone. One register for
// the whole site: an invitation, not an instruction.
const PROMPT_LABEL = "write here";

export default async function PlayBrowseSlugPage({
  params,
}: {
  params: Promise<{ tag: string; slug: string }>;
}) {
  const { tag: rawTag, slug } = await params;
  const tag = decodeURIComponent(rawTag);

  const category = findCategoryForTag(tag);
  if (!category) notFound();

  // Real, spanned provenance for THIS tag, regardless of mode — the
  // mode/gateway split no longer gates anything here.
  if (!playableSlugsForTag(tag).includes(slug)) notFound();

  const post = getPostBySlug(slug);
  if (!post) notFound();

  const provenanceTags = getProvenanceTags(slug) ?? {};
  const singleTag = provenanceTags[tag] ? { [tag]: provenanceTags[tag] } : {};

  const bodyText     = post.content.trim();
  const titleWeights = computeWeights(post.title, singleTag);
  const primaryWeights = computeWeights(bodyText, singleTag) ?? [];

  // Same cluster-merging as before (see the original comment in the old
  // [gateway]/[tag]/[slug] route this replaces): bring in the rest of a
  // passage the tag's own span touches, marked -1 ("borrowed context"),
  // so a multi-tag argument stays legible instead of fragmenting.
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

  return (
    <PlayScreen
      slug={slug}
      tag={tag}
      categoryTitle={category.title}
      title={post.title}
      titleWeights={titleWeights}
      body={bodyText}
      bodyWeights={bodyWeights}
      promptLabel={PROMPT_LABEL}
      backHref={`/play/browse/${encodeURIComponent(tag)}`}
    />
  );
}
