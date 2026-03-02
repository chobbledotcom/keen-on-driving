#!/usr/bin/env bun

import {
  createReviewFetcher,
  fetchFromApify,
  runMain,
} from "./fetch-reviews-shared.js";

const ACTOR_ID = "nwua9Gu5YrADL7ZDj";
const MAX_REVIEWS = 9999;

const normalizeReview = (r) => ({
  content: r.text || r.reviewText,
  date: new Date(r.publishedAtDate),
  rating: r.stars,
  author: r.name || r.authorName,
  authorUrl: r.reviewerUrl || r.authorUrl,
});

const fetchReviews = async (placeId) => {
  const results = await fetchFromApify(ACTOR_ID, {
    startUrls: [
      { url: `https://www.google.com/maps/place/?q=place_id:${placeId}` },
    ],
    maxReviews: MAX_REVIEWS,
    reviewsSort: "newest",
    language: "en",
  });

  return results
    .flatMap((item) => item.reviews || [])
    .map(normalizeReview)
    .filter((r) => r.content?.length > 5);
};

const main = createReviewFetcher({
  source: "google",
  configField: "google_place_id",
  fetchReviews,
  formatLog: (r) => `${r.rating}/5 stars`,
});

if (import.meta.main) runMain(main);
