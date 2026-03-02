#!/usr/bin/env bun

import {
  createReviewFetcher,
  fetchFromApify,
  runMain,
} from "./fetch-reviews-shared.js";

const ACTOR_ID = "dX3d80hsNMilEwjXG";
const MAX_REVIEWS = 9999;

const normalizeReview = (review) => {
  const user = review.user || {};
  return {
    content: review.text || "",
    date: review.date ? new Date(review.date) : new Date(),
    rating: review.isRecommended ? 5 : 1,
    author: user.name || "Anonymous",
    authorUrl: review.url || user.profileUrl || "",
  };
};

const fetchReviews = async (pageUrl) => {
  const results = await fetchFromApify(ACTOR_ID, {
    startUrls: [{ url: pageUrl }],
    maxReviews: MAX_REVIEWS,
  });

  return results.map(normalizeReview).filter((r) => r.content?.length > 5);
};

const main = createReviewFetcher({
  source: "facebook",
  configField: "facebook_page_url",
  fetchReviews,
  formatLog: (r) => (r.rating === 5 ? "recommended" : "not recommended"),
});

if (import.meta.main) runMain(main);
