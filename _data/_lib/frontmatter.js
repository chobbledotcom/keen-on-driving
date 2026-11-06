// Shared front-matter and directory helpers for the _data modules.
//
// Eleventy ignores data files under underscore-prefixed folders, so this module
// is not exposed as a global data key - it only serves sibling data files.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// _lib sits at <root>/src/_data/_lib in the merged build and <root>/_data/_lib
// locally, so the project root is two dirname() steps up - no ".." segments.
const projectRoot = dirname(dirname(here));

// Resolve a directory that sits at the project root (e.g. areas-covered/).
const dataDir = (name) => join(projectRoot, name);

// Read a directory next to _data/ and return every entry, filtered by suffix.
const readDataDir = (name, suffix) =>
  existsSync(dataDir(name))
    ? readdirSync(dataDir(name)).filter((entry) => entry.endsWith(suffix))
    : [];

// Read a file next to _data/ as UTF-8 text.
const readDataFile = (dir, name) =>
  readFileSync(join(dataDir(dir), name), "utf8");

// Strip surrounding quotes and whitespace from a front-matter value.
const unquote = (value) => value.replace(/^["']|["']$/g, "").trim();

// Pull a single scalar value out of a front-matter block by key.
const scalar = (frontmatter, key) => {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, "m"));
  return match ? unquote(match[1]) : null;
};

// Extract the front-matter body of a markdown file, or null when absent.
const frontmatterOf = (raw) => {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  return match ? match[1] : null;
};

export { dataDir, frontmatterOf, readDataDir, readDataFile, scalar, unquote };
