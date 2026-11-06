#!/usr/bin/env bun

// Fetches the Facebook page's posts via Apify and saves one JSON record per
// post, downloading the images alongside. Adapted from
// ../monster-event-hire/scripts/fetch-facebook-posts.js and the Apify helpers
// in ../bcn-tools/scripts/social-posts.py.
//
// Posts are what the business actually does week to week: pass announcements,
// lesson availability, and the odd local notice. _data/facebookPosts.js reads
// this folder for the site, and the JSON stays the full record.
//
// Usage:
//   bun scripts/fetch-facebook-posts.js
//   bun scripts/fetch-facebook-posts.js --limit=40
//   bun scripts/fetch-facebook-posts.js --all     # full re-scrape

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { exists, fs, loadEnv, path, readJson, write } from "./utils.js";

await loadEnv();

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const forceAll = args.includes("--all");

const CONFIG = {
  postsDir: path("facebook-posts"),
  imagesDir: path("images", "facebook-posts"),
  siteConfig: path("_data", "site.json"),
  actorId: "KoJrdxJCTtpon81KY", // apify/facebook-posts-scraper
  resultsLimit: limitArg ? Number(limitArg.split("=")[1]) : 100,
};

const isMsTimestamp = (value) => value > 1e12;

const toIso = (value) => {
  if (typeof value === "number") {
    return new Date(isMsTimestamp(value) ? value : value * 1000).toISOString();
  }
  return new Date(value).toISOString();
};

const formatSlug = (iso, id) => {
  const safeDate = iso.replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const safeId = String(id)
    .replace(/[^a-z0-9]/gi, "-")
    .slice(0, 24);
  return `${safeDate}-${safeId}`;
};

const getMediaImageUrl = (item) =>
  item?.image?.uri ||
  item?.photo_image?.uri ||
  item?.thumbnail ||
  null;

const getImageUrls = (post) => [
  ...new Set(
    [
      post.fullPicture,
      post.image,
      post.displayUrl,
      ...(post.media?.map(getMediaImageUrl) || []),
    ].filter((url) => typeof url === "string" && url),
  ),
];

const readExisting = () => {
  if (!fs.exists(CONFIG.postsDir)) return [];
  return readdirSync(CONFIG.postsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try {
        return JSON.parse(readFileSync(join(CONFIG.postsDir, file), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
};

const newestSavedDate = (records) => {
  const times = records
    .map((record) => (record?.date ? new Date(record.date).getTime() : 0))
    .filter(Boolean);
  return times.length ? Math.max(...times) : null;
};

const fetchPosts = async (profileUrl, since) => {
  const input = {
    startUrls: [{ url: profileUrl }],
    resultsLimit: CONFIG.resultsLimit,
  };
  if (since) input.onlyPostsNewerThan = since;

  console.log(`Fetching Facebook posts for ${profileUrl}...`);

  const res = await fetch(
    `https://api.apify.com/v2/acts/${CONFIG.actorId}/run-sync-get-dataset-items?token=${process.env.APIFY_API_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const results = await res.json();
  if (!Array.isArray(results)) throw new Error("Invalid API response format");

  return results
    .filter(
      (post) =>
        !post.sharedPost &&
        (post.topLevelUrl || post.url) &&
        (post.createdTime || post.time || post.timestamp),
    )
    .map((post) => ({
      id: post.postId || post.id || post.url,
      date: toIso(post.createdTime || post.time || post.timestamp),
      text: (post.message || post.text || post.caption || "").trim(),
      url: post.topLevelUrl || post.url,
      likes: post.likes || 0,
      comments: post.comments || 0,
      shares: post.shares || 0,
      isVideo: Boolean(post.isVideo),
      imageUrls: getImageUrls(post),
    }));
};

const downloadImage = async (imageUrl, filepath) => {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
  await write(filepath, await res.arrayBuffer());
};

const getImageFilename = (slug, index, imageUrl) => {
  const ext = imageUrl.includes(".png") ? "png" : "jpg";
  return `${slug}${index === 0 ? "" : `-${index + 1}`}.${ext}`;
};

const downloadPostImages = async (post, slug, existing) => {
  const images = [];
  for (const [index, imageUrl] of post.imageUrls.entries()) {
    const filename = getImageFilename(slug, index, imageUrl);
    const imagePath = join(CONFIG.imagesDir, filename);
    const publicPath = `/images/facebook-posts/${filename}`;

    if (await exists(imagePath)) {
      images.push(publicPath);
      continue;
    }

    try {
      await downloadImage(imageUrl, imagePath);
      images.push(publicPath);
    } catch (err) {
      console.warn(
        `  Could not download image ${index + 1} for ${slug}: ${err.message}`,
      );
    }
  }

  return images.length
    ? images
    : existing?.images || (existing?.thumbnail ? [existing.thumbnail] : []);
};

const savePost = async (post) => {
  const slug = formatSlug(post.date, post.id);
  const jsonPath = join(CONFIG.postsDir, `${slug}.json`);
  const existing = (await exists(jsonPath))
    ? await readJson(jsonPath)
    : null;

  const images = post.imageUrls.length
    ? await downloadPostImages(post, slug, existing)
    : existing?.images || (existing?.thumbnail ? [existing.thumbnail] : []);

  const record = {
    id: post.id,
    date: post.date,
    text: post.text,
    url: post.url,
    likes: post.likes,
    comments: post.comments,
    shares: post.shares,
    ...(post.isVideo ? { isVideo: true } : {}),
    ...(images.length ? { images, thumbnail: images[0] } : {}),
  };

  if (existing && JSON.stringify(record) === JSON.stringify(existing)) {
    return false;
  }

  await write(jsonPath, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`${slug}.json`);
  return true;
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
  const profileUrl =
    siteConfig.socials?.Facebook || siteConfig.facebook_page_url;
  if (!profileUrl) {
    console.error("Error: Facebook URL missing from site.json");
    process.exit(1);
  }

  fs.mkdir(CONFIG.postsDir);
  fs.mkdir(CONFIG.imagesDir);

  const existing = readExisting();
  const cutoff = forceAll ? null : newestSavedDate(existing);
  if (cutoff) {
    console.log(`Last scrape: ${new Date(cutoff).toISOString()}`);
  } else {
    console.log("No previous scrape found, fetching all available posts");
  }

  const posts = await fetchPosts(
    profileUrl,
    cutoff ? new Date(cutoff).toISOString() : null,
  );
  console.log(`Found ${posts.length} posts from Apify`);

  const selected = cutoff
    ? posts.filter((post) => new Date(post.date).getTime() > cutoff)
    : posts;
  console.log(`${selected.length} posts selected`);

  const saved = (await Promise.all(selected.map(savePost))).filter(
    Boolean,
  ).length;

  console.log(
    `\nSaved or repaired ${saved} posts (${selected.length - saved} unchanged)`,
  );
};

if (import.meta.main) {
  main().catch((err) => {
    console.error("Error:", err.message);
    process.exit(1);
  });
}
