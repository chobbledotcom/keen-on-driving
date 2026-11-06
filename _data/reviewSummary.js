// Aggregates the review markdown files so a page can state the real count and
// average without hand-maintained copy drifting away from the data.
//
// Reviews live in reviews/*.md and carry name, rating, source and date in
// their front matter. Google reviews are written by
// scripts/fetch-google-reviews.js; the rest were copied from Facebook.

import { readDataDir, readDataFile, scalar, frontmatterOf } from "./_lib/frontmatter.js";

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const reviews = readDataDir("reviews", ".md")
  .map((file) => {
    const raw = readDataFile("reviews", file);
    const frontmatter = frontmatterOf(raw);
    if (!frontmatter) return null;

    const date = scalar(frontmatter, "date") ||
      file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ||
      "";
    const source = scalar(frontmatter, "source") ||
      (file.includes("-google-") ? "Google" : "Facebook");

    return {
      author: scalar(frontmatter, "name") || "Anonymous",
      rating: toNumber(scalar(frontmatter, "rating")),
      source,
      date,
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.date.localeCompare(a.date));

const google = reviews.filter((review) => review.source === "Google");
const facebook = reviews.filter((review) => review.source === "Facebook");
const ratings = reviews.map((review) => review.rating).filter(Boolean);
const average = ratings.length
  ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
  : 0;

export default {
  reviews,
  google,
  facebook,
  total: reviews.length,
  googleCount: google.length,
  facebookCount: facebook.length,
  average: average.toFixed(1),
  fiveStarCount: ratings.filter((rating) => rating === 5).length,
  latest: reviews[0]?.date || "",
};
