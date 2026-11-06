// Recent Facebook posts, shaped for the site's post cards.
//
// Each scraped record in facebook-posts/*.json (written by
// scripts/fetch-facebook-posts.js) contains { id, date, text, url, likes,
// comments, shares, images, thumbnail }. The include shows the newest posts
// with an image, and pulls pass announcements out separately so the home and
// photos pages can lead with named passes.

import { readDataDir, readDataFile } from "./_lib/frontmatter.js";

const MAX_TEXT = 260;
const MAX_TITLE = 90;

const truncate = (text, max) => {
  const value = text.trim();
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
};

const byDateDesc = (a, b) => new Date(b.date) - new Date(a.date);

const EMOJI_DIGITS = {
  "0️⃣": "0",
  "1️⃣": "1",
  "2️⃣": "2",
  "3️⃣": "3",
  "4️⃣": "4",
  "5️⃣": "5",
  "6️⃣": "6",
  "7️⃣": "7",
  "8️⃣": "8",
  "9️⃣": "9",
};

const plainText = (text) =>
  text.replace(/[0-9]️⃣/g, (digit) => EMOJI_DIGITS[digit] || digit);

const pupilFrom = (text) => {
  const patterns = [
    /\bfor ([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/,
    /\b(?:it is|it's|this is) ([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:who|is|passed|had)\b/,
    /^([A-Z][a-z]+(?: [A-Z][a-z]+)?) (?:had to wait|has passed|passed)\b/m,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
};

const NUMBER_WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const faultsFrom = (text) => {
  const match = plainText(text).match(
    /(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*driver faults?/i,
  );
  if (!match) return null;
  const value = match[1].toLowerCase();
  return value in NUMBER_WORDS ? NUMBER_WORDS[value] : Number(value);
};

const testCentreFrom = (text) => {
  const match = text.match(/\b(Nelson|Bury|Blackburn|Bolton|Burnley)\b/i);
  return match ? match[1] : null;
};

const describePass = (post) => {
  const pupil = pupilFrom(post.text);
  const faults = faultsFrom(post.text);
  const firstTime = /first[- ]time|1st time/i.test(post.text);
  const centre = testCentreFrom(post.text);
  if (!pupil || !/pass/i.test(post.text)) return null;

  const facts = firstTime ? "first-time pass" : "pass";
  const place = centre ? ` at ${centre}` : "";
  const faultsText =
    faults !== null
      ? ` with ${faults} driver fault${faults === 1 ? "" : "s"}`
      : "";
  return {
    pupil,
    faults,
    firstTime,
    centre,
    summary: `${facts}${place}${faultsText}`,
  };
};

const readPost = (name) => {
  try {
    return JSON.parse(readDataFile("facebook-posts", name));
  } catch {
    return null;
  }
};

const allPosts = readDataDir("facebook-posts", ".json")
  .map(readPost)
  .filter((post) => post?.url && post.date)
  .sort(byDateDesc)
  .map((post) => {
    const pass = describePass(post);
    return {
      ...post,
      text: post.text || "",
      title: truncate(plainText(post.text).replace(/\s+/g, " "), MAX_TITLE),
      excerpt: truncate(plainText(post.text).replace(/\s+/g, " "), MAX_TEXT),
      ...(pass ? { pass } : {}),
    };
  });

const posts = allPosts.filter((post) => post.title !== "");
const passes = allPosts.filter((post) => post.pass);

export default { posts, passes };
