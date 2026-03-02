import { join } from "node:path";
import { exists, fs, loadEnv, path, readJson, write } from "./utils.js";

const CONFIG = {
  siteConfig: path("_data", "site.json"),
  reviewsDir: path("reviews"),
};

export const formatFilename = (name, source, date) => {
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "-")
    .substring(0, 30);
  return `${safeName}-${source}-${date.toISOString().split("T")[0]}.md`;
};

export const saveReview = async (review, source, dir) => {
  const filename = formatFilename(review.author, source, review.date);
  const filepath = join(dir, filename);

  if (await exists(filepath)) return false;

  await write(
    filepath,
    `---
name: ${review.author}
url: ${review.authorUrl}
rating: ${review.rating}
---

${review.content}
`,
  );

  return filename;
};

export const fetchFromApify = async (actorId, body) => {
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${process.env.APIFY_API_TOKEN}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);

  const results = await res.json();
  if (!Array.isArray(results)) throw new Error("Invalid API response format");

  return results;
};

const requireEnv = () => {
  if (!process.env.APIFY_API_TOKEN) {
    console.error("Error: APIFY_API_TOKEN required in .env file");
    console.error("Get token: https://console.apify.com/account/integrations");
    process.exit(1);
  }
};

const loadSiteConfig = async (configField) => {
  if (!(await exists(CONFIG.siteConfig))) {
    console.error(`Error: ${CONFIG.siteConfig} not found`);
    process.exit(1);
  }

  const siteConfig = await readJson(CONFIG.siteConfig);
  if (!siteConfig[configField]) {
    console.error(`Error: ${configField} missing from site.json`);
    process.exit(1);
  }

  return siteConfig[configField];
};

const saveNewReviews = async (reviews, source, formatLog) => {
  let saved = 0;
  for (const review of reviews) {
    const filename = await saveReview(review, source, CONFIG.reviewsDir);
    if (filename) {
      console.log(`${filename} (${formatLog(review)})`);
      saved++;
    }
  }
  return saved;
};

export const createReviewFetcher =
  ({ source, configField, fetchReviews, formatLog }) =>
  async () => {
    await loadEnv();
    requireEnv();

    const configValue = await loadSiteConfig(configField);
    fs.mkdir(CONFIG.reviewsDir);

    console.log(`Fetching ${source} reviews...`);
    const reviews = await fetchReviews(configValue);
    console.log(`Found ${reviews.length} reviews`);

    const saved = await saveNewReviews(reviews, source, formatLog);

    console.log(
      `\nSaved ${saved} new reviews (${reviews.length - saved} already existed)`,
    );
  };

export const runMain = (main) => {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
};
