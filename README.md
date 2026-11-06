# Chobble Client Site Builder

Quick static site generator that combines the [Chobble Template](https://git.chobble.com/chobble/chobble-template/) with your content.

## Quick Start

1. **Add your content** - Edit markdown files and images in the relevant folders
2. **Push to GitHub** - The site builds automatically via GitHub Actions
3. **Deploy happens automatically** - Site deploys to Neocities (or your chosen host)

## What Goes Where

The `.pages.yml` defines all your content types:
- `pages/` - Static pages with navigation
- `news/` - Blog posts with dates
- `products/` - Shop items with prices and Etsy links
- `categories/` - Product categories
- `team/` - Team member profiles
- `reviews/` - Customer testimonials
- `events/` - Upcoming events
- `menus/`, `menu-categories/`, `menu-items/` - Restaurant menu system
- `snippets/` - Reusable content bits
- `images/` - All your images

## How It Works

When you push to GitHub:
1. GitHub Actions merges your content with the template
2. Builds the static site with Eleventy
3. Deploys to your configured hosting (Neocities by default)

## Configuration

Set these GitHub secrets for your repo:
- `NEOCITIES_API_KEY` - For deployment
- `FORMSPARK_ID` - For contact forms (optional)
- `BOTPOISON_PUBLIC_KEY` - For spam protection (optional)

## Local Development

Run `./bin/build` to build locally. The output appears in `result/`.

## Reviews and Facebook posts

Three Apify-backed scripts keep the social proof up to date:

- `bun run fetch-google-reviews` fetches every Google review for the place ID in `_data/site.json`, then creates or updates one markdown file per review in `reviews/` and writes the current rating and count to `_data/googleReviews.json`. `--all` also removes reviews that have gone from the listing.
- `bun run fetch-facebook-posts` fetches the Facebook page's posts, writes one JSON record per post to `facebook-posts/`, and downloads the images to `images/facebook-posts/`. Re-runs only fetch posts newer than the newest saved one.
- `bun run fetch-facebook-reviews` fetches Facebook recommendations and adds any new ones to `reviews/`.

All three need `APIFY_API_TOKEN` in `.env` locally, or as a GitHub Actions secret. The combined `Fetch Reviews and Social Posts` workflow runs them weekly, commits whatever changed, and its completion triggers the build and deploy workflow, so the counts, quotes, reviews page and pass cards update without a manual push.
