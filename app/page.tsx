import { getAllPosts, getTagCounts } from "@/lib/posts";
import HomeClient from "./HomeClient";

// Built once per deploy: the tag cloud's data ships inside the page itself.
// Only the fields the home page uses are sent (no excerpts).
export default function Home() {
  const posts = getAllPosts().map(({ slug, title, date, tags }) => ({ slug, title, date, tags }));
  return <HomeClient initialTagCounts={getTagCounts()} initialPosts={posts} />;
}
