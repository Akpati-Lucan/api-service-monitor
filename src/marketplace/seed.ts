import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createMarketplaceStore, type ListingDraft, type ListingLinkRecord } from "./store.js";

const reviewedAt = "2026-11-01T00:00:00.000Z";

const seeds: Array<ListingDraft & { links: Array<Omit<ListingLinkRecord, "listingId">>; guide: { slug: string; title: string; summary: string; bodyMd: string; prerequisites: string } | null }> = [
  {
    id: "lst_northwind_payments",
    slug: "northwind-payments",
    name: "Northwind Payments",
    summary: "Card payments hosted by the provider. Vision API only links to the provider.",
    descriptionMd: "Use this listing to read the provider's own documentation, pricing, and status page.\n\nVision API does not process payments and does not hold a subscription for you.",
    category: "payments",
    tags: ["cards", "checkout"],
    listingType: "api",
    pricingModel: "external",
    currency: null,
    priceSummary: "Pricing is published by the provider.",
    providerName: "Example",
    providerDomain: "example.com",
    docsUrl: "https://example.com/payments/docs",
    signupUrl: "https://example.com/payments/signup",
    pricingUrl: "https://example.com/payments/pricing",
    statusUrl: "https://example.com/payments/status",
    termsUrl: "https://example.com/payments/terms",
    privacyUrl: "https://example.com/payments/privacy",
    regions: ["us", "eu"],
    capabilities: ["charges"],
    requirements: ["A provider account"],
    createdAt: reviewedAt,
    links: [
      { id: "lnk_payments_docs", label: "Documentation", url: "https://example.com/payments/docs", kind: "docs", sortOrder: 1, enabled: true },
      { id: "lnk_payments_pricing", label: "Pricing", url: "https://example.com/payments/pricing", kind: "pricing", sortOrder: 2, enabled: true },
      { id: "lnk_payments_signup", label: "Sign up", url: "https://example.com/payments/signup", kind: "signup", sortOrder: 3, enabled: true },
      { id: "lnk_payments_status", label: "Provider status", url: "https://example.com/payments/status", kind: "status", sortOrder: 4, enabled: true },
      { id: "lnk_payments_terms", label: "Terms", url: "https://example.com/payments/terms", kind: "terms", sortOrder: 5, enabled: true },
      { id: "lnk_payments_privacy", label: "Privacy", url: "https://example.com/payments/privacy", kind: "privacy", sortOrder: 6, enabled: true },
    ],
    guide: {
      slug: "evaluate-northwind-payments",
      title: "Evaluate Northwind Payments",
      summary: "Read the provider docs and try a placeholder key in your own sandbox.",
      prerequisites: "A provider test account. No Vision API credential is required.",
      bodyMd: "## Try the provider sandbox\n\nCreate a test key at the provider. Keep it in your own environment.\n\n```\nAPI_KEY=YOUR_API_KEY\n```\n\n<script>alert(1)</script>\n\nWhen you are done, revoke the test key at the provider.",
    },
  },
  {
    id: "lst_northwind_messages",
    slug: "northwind-messages",
    name: "Northwind Messages",
    summary: "Outbound messages sent by the provider from the provider's console.",
    descriptionMd: "The provider sends the message. This directory only points at their documentation and status page.",
    category: "messaging",
    tags: ["sms"],
    listingType: "api",
    pricingModel: "usage_based",
    currency: null,
    priceSummary: "The provider charges per message.",
    providerName: "Example",
    providerDomain: "example.com",
    docsUrl: "https://example.com/messages/docs",
    signupUrl: "https://example.com/messages/signup",
    pricingUrl: "https://example.com/messages/pricing",
    statusUrl: "https://example.com/messages/status",
    termsUrl: "https://example.com/messages/terms",
    privacyUrl: "https://example.com/messages/privacy",
    regions: ["us"],
    capabilities: ["sms"],
    requirements: ["A provider account"],
    createdAt: reviewedAt,
    links: [
      { id: "lnk_messages_docs", label: "Documentation", url: "https://example.com/messages/docs", kind: "docs", sortOrder: 1, enabled: true },
      { id: "lnk_messages_pricing", label: "Pricing", url: "https://example.com/messages/pricing", kind: "pricing", sortOrder: 2, enabled: true },
      { id: "lnk_messages_signup", label: "Sign up", url: "https://example.com/messages/signup", kind: "signup", sortOrder: 3, enabled: true },
      { id: "lnk_messages_status", label: "Provider status", url: "https://example.com/messages/status", kind: "status", sortOrder: 4, enabled: true },
      { id: "lnk_messages_terms", label: "Terms", url: "https://example.com/messages/terms", kind: "terms", sortOrder: 5, enabled: true },
      { id: "lnk_messages_privacy", label: "Privacy", url: "https://example.com/messages/privacy", kind: "privacy", sortOrder: 6, enabled: true },
    ],
    guide: null,
  },
];

export function seedMarketplace(db: Database.Database): void {
  const store = createMarketplaceStore(db);
  for (const seed of seeds) {
    if (store.getListingBySlug(seed.slug)) continue;
    const { links, guide, ...draft } = seed;
    store.insertListing(draft);
    store.replaceLinks(draft.id, links);
    store.updateListing(draft.id, {
      status: "published",
      publishedAt: reviewedAt,
      reviewedBy: "vision-editorial",
      reviewNote: null,
      updatedAt: reviewedAt,
    });
    store.insertReview({
      id: randomUUID(),
      listingId: draft.id,
      reviewerId: "vision-editorial",
      decision: "approve",
      note: "Seed reviewed 2026-11-01. Links point at example.com.",
      createdAt: reviewedAt,
    });
    if (guide) {
      store.insertGuide({
        id: randomUUID(),
        listingId: draft.id,
        slug: guide.slug,
        title: guide.title,
        summary: guide.summary,
        bodyMd: guide.bodyMd,
        prerequisites: guide.prerequisites,
        difficulty: "beginner",
        published: true,
        verifiedAt: reviewedAt,
        verifiedBy: "vision-editorial",
        createdAt: reviewedAt,
        updatedAt: reviewedAt,
      });
    }
  }
}
