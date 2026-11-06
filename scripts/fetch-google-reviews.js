#!/usr/bin/env bun

// Fetches every Google review for the place in _data/site.json and saves each
// one as a review markdown file. Modelled on the Apify helpers in
// ../bcn-tools/scripts: the run is started asynchronously and polled, because
// the run-sync endpoints cut the connection at 300 seconds, and re-runs are
// incremental (reviewsStartDate) so a weekly refresh costs pennies.
//
// Usage:
//   bun scripts/fetch-google-reviews.js
//   bun scripts/fetch-google-reviews.js --all       # full re-scrape
//   bun scripts/fetch-google-reviews.js --limit=50

import { join } from "node:path";
import { exists, fs, loadEnv, path, readJson, write } from "./utils.js";

await loadEnv();

const args = process.argv.slice(2);
const forceAll = args.includes("--all");
const limitArg = args.find((a) => a.startsWith("--limit="));
const sortArg = args.find((a) => a.startsWith("--sort="));
const timeoutArg = args.find((a) => a.startsWith("--timeout="));

const CONFIG = {
  siteConfig: path("_data", "site.json"),
  summary: path("_data", "googleReviews.json"),
  reviewsDir: path("reviews"),
  actorId: "nwua9Gu5YrADL7ZDj", // compass/crawler-google-places
  maxReviews: limitArg ? Number(limitArg.split("=")[1]) : 9999,
  sort: sortArg ? sortArg.split("=")[1] : "newest",
  timeoutSecs: timeoutArg ? Number(timeoutArg.split("=")[1]) : 1800,
  pollSecs: 5,
};

const api = async (method, endpoint, body) => {
  const url = `https://api.apify.com/v2${endpoint}`;
  const separator = endpoint.includes("?") ? "&" : "?";
  const res = await fetch(
    `${url}${separator}token=${process.env.APIFY_API_TOKEN}`,
    {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.json()).error?.message || "";
    } catch {}
    throw new Error(
      `Apify ${method} ${endpoint} failed: HTTP ${res.status}${
        detail ? ` - ${detail}` : ""
      }`,
    );
  }

  const json = await res.json();
  return Array.isArray(json) ? json : (json.data ?? json);
};

const runActor = async (actorId, input) => {
  const run = await api("POST", `/acts/${actorId}/runs`, input);
  console.log(`Apify run ${run.id} started (${run.status})`);

  const started = Date.now();
  let lastStatus = null;

  while (true) {
    const current = await api("GET", `/actor-runs/${run.id}`);
    if (current.status !== lastStatus) {
      console.log(
        `  ${current.status} (${Math.round((Date.now() - started) / 1000)}s)`,
      );
      lastStatus = current.status;
    }

    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(current.status)) {
      if (current.status !== "SUCCEEDED") {
        throw new Error(`Apify run ${run.id} finished ${current.status}`);
      }
      return current;
    }

    if ((Date.now() - started) / 1000 > CONFIG.timeoutSecs) {
      throw new Error(
        `Apify run ${run.id} still ${current.status} after ${CONFIG.timeoutSecs}s. ` +
          `It continues at https://console.apify.com/actors/runs/${run.id}`,
      );
    }

    await Bun.sleep(CONFIG.pollSecs * 1000);
  }
};

const fetchDataset = async (datasetId) => {
  const items = [];
  let offset = 0;
  while (true) {
    const page = await api(
      "GET",
      `/datasets/${datasetId}/items?clean=true&offset=${offset}&limit=500`,
    );
    items.push(...page);
    if (page.length < 500) return items;
    offset += page.length;
  }
};

const decodeEntities = (text) =>
  text
    .replace(/<br\s*\/?>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const isoDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const slugify = (name) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "anonymous";

const yaml = (value) => JSON.stringify(String(value ?? ""));

const reviewDate = (review) =>
  isoDate(review.publishedAtDate || review.publishAt);

const normaliseReview = (raw) => {
  const text = decodeEntities(raw.text || raw.reviewText || "");
  const response = decodeEntities(
    raw.responseFromOwnerText || raw.ownerResponse || "",
  );
  return {
    id: raw.reviewId || "",
    name: raw.name || raw.authorName || "Anonymous",
    rating: raw.stars || raw.rating || 0,
    date: reviewDate(raw),
    text,
    response,
    url: raw.reviewUrl || raw.authorUrl || raw.reviewerUrl || "",
  };
};

// Existing review files, so re-runs only add new ones. Google reviews are
// identified by source/name; the facebook reviews in the same folder are
// ignored for the incremental cutoff.
const readExisting = async () => {
  const records = [];
  if (!fs.exists(CONFIG.reviewsDir)) return records;

  for (const file of new Bun.Glob("*.md").scanSync({ cwd: CONFIG.reviewsDir })) {
    const content = await Bun.file(join(CONFIG.reviewsDir, file)).text();
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) continue;

    const field = (key) => {
      const line = match[1].match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
      if (!line) return "";
      return line[1].trim().replace(/^["']|["']$/g, "");
    };

    const source = field("source") || (file.includes("-google-") ? "Google" : "");
    records.push({
      file,
      source,
      name: field("name"),
      date: field("date") || file.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || "",
      id: field("review_id"),
    });
  }

  return records;
};

const saveReview = async (review, existing) => {
  const duplicate = existing.some(
    (record) =>
      record.source === "Google" &&
      (review.id
        ? record.id === review.id
        : record.name === review.name && record.date === review.date),
  );
  if (duplicate) return false;

  const filename = `${slugify(review.name)}-google-${review.date || "undated"}.md`;
  const filepath = join(CONFIG.reviewsDir, filename);

  if (await exists(filepath)) return false;

  const frontMatter = [
    "---",
    `name: ${yaml(review.name)}`,
    `url: ${yaml(review.url)}`,
    `rating: ${review.rating}`,
    `date: ${yaml(review.date)}`,
    `source: Google`,
  ];
  if (review.id) frontMatter.push(`review_id: ${yaml(review.id)}`);
  if (review.response) frontMatter.push(`owner_response: ${yaml(review.response)}`);
  frontMatter.push("---", "", review.text, "");

  await write(filepath, frontMatter.join("\n"));
  console.log(`${filename} (${review.rating}/5 stars)`);
  return true;
};

const saveSummary = async (place) => {
  const summary = {
    place_id: place.placeId || "",
    rating:
      place.totalScore === null || place.totalScore === undefined
        ? null
        : Number(place.totalScore).toFixed(1),
    review_count: place.reviewsCount ?? null,
  };
  if (summary.rating) summary.rating_display = `${summary.rating} stars`;
  await write(CONFIG.summary, `${JSON.stringify(summary, null, 2)}\n`);
};

const main = async () => {
  if (!process.env.APIFY_API_TOKEN) {
    console.error("Error: APIFY_API_TOKEN required in .env file");
    console.error("Get token: https://console.apify.com/account/integrations");
    process.exit(1);
  }

  if (!(await exists(CONFIG.siteConfig))) {
    console.error(`Error: ${CONFIG.siteConfig} not found`);
    process.exit(1);
  }

  const siteConfig = await readJson(CONFIG.siteConfig);
  const placeId = siteConfig.google_place_id;
  if (!placeId) {
    console.error("Error: google_place_id missing from site.json");
    process.exit(1);
  }

  fs.mkdir(CONFIG.reviewsDir);

  const existing = forceAll ? [] : await readExisting();
  const googleRecords = existing.filter((record) => record.source === "Google");
  const newest = googleRecords
    .map((record) => record.date)
    .filter(Boolean)
    .sort()
    .at(-1);

  const input = {
    placeIds: [placeId],
    maxReviews: CONFIG.maxReviews,
    reviewsSort: CONFIG.sort,
    language: "en",
  };
  if (newest && !forceAll) input.reviewsStartDate = newest;

  console.log(
    newest && !forceAll
      ? `Fetching reviews newer than ${newest}...`
      : "Fetching all available reviews...",
  );

  const run = await runActor(CONFIG.actorId, input);
  const items = await fetchDataset(run.defaultDatasetId);
  const place = items[0];

  if (!place) {
    console.error("Error: Apify returned no place for that place ID.");
    process.exit(1);
  }

  console.log(
    `${place.title} - ${place.reviewsCount ?? "?"} reviews at ` +
      `${place.totalScore ?? "?"} stars`,
  );

  const reviews = (place.reviews || []).map(normaliseReview);
  const unique = [
    ...new Map(
      reviews
        .filter((review) => review.text.length > 5)
        .map((review) => [review.id || `${review.name}|${review.date}`, review]),
    ).values(),
  ];

  let saved = 0;
  for (const review of unique) {
    if (await saveReview(review, existing)) saved += 1;
  }

  await saveSummary(place);

  console.log(
    `\nSaved ${saved} new Google reviews (${unique.length - saved} already existed)`,
  );
};

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
