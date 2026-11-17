import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { createMarketplaceStore, type GuideRecord, type ListingDraft, type ListingLinkRecord } from "./store.js";

const reviewedAt = "2026-11-01T00:00:00.000Z";

interface PaymentsGuide {
  slug: string;
  title: string;
  summary: string;
  bodyMd: string;
  prerequisites: string;
  purpose: string;
  minPermissions: string;
  credentialLocation: string;
  localTestMd: string;
  productionMd: string;
  securityNotes: string;
  costNotes: string;
  commonErrorsMd: string;
  cleanupMd: string;
  testedVersion: string;
  testEnvironment: string;
  compatibilityNotes: string;
  exampleText: string;
  successMd: string;
}

const seeds: Array<ListingDraft & { links: Array<Omit<ListingLinkRecord, "listingId">>; guide: PaymentsGuide | null }> = [
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
      purpose: "Decide whether this provider belongs in your system before you connect anything.",
      minPermissions: "A test-mode key that can create one test charge and nothing else.",
      credentialLocation: "The provider dashboard. The key stays in your shell.",
      localTestMd: "Export a placeholder and call the provider sandbox from your own machine.",
      productionMd: "Create a dependency monitor for the provider status URL. Put the real token in secretRef on your monitor, not in this guide.",
      securityNotes: "Use a test key. Rotate it at the provider. Do not paste it into Vision API.",
      costNotes: "Live charges can cost money. This guide stays in the provider sandbox.",
      commonErrorsMd: "A down owned service is yours. A down provider status page is the provider.",
      cleanupMd: "Revoke the test key in the provider dashboard and pause the dependency monitor.",
      testedVersion: "Provider docs reviewed 2026-11-01",
      testEnvironment: "Provider sandbox",
      compatibilityNotes: "Pairs with an HTTP monitor whose role is dependency.",
      exampleText: "# Revision 1. Read-only. Run this against your own monitor.\n# YOUR_API_TOKEN stays in this shell. It is not sent to Vision API.\ncurl -sS -H \"Authorization: Bearer YOUR_API_TOKEN\" \"http://127.0.0.1:3000/services\"\n",
      successMd: "In the provider sandbox, create one test charge. The provider shows a test identifier. That is the success state. Do not paste the identifier or the key into Vision API.",
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
      const saved = guideRecord(draft.id, guide);
      store.insertGuide(saved);
      store.insertRevision({
        id: randomUUID(),
        guideId: saved.id,
        version: 1,
        note: "Reviewed with the listing on 2026-11-01.",
        author: "vision-editorial",
        verifiedAt: reviewedAt,
        snapshotJson: "{}",
        createdAt: reviewedAt,
      });
    }
  }
  for (const lesson of libraryGuides()) {
    if (store.getGuideBySlug(lesson.slug)) continue;
    store.insertGuide(lesson);
    store.insertRevision({
      id: randomUUID(),
      guideId: lesson.id,
      version: 1,
      note: "Learning center review.",
      author: "vision-editorial",
      verifiedAt: reviewedAt,
      snapshotJson: "{}",
      createdAt: reviewedAt,
    });
  }
}

function guideRecord(listingId: string, guide: PaymentsGuide): GuideRecord {
  return {
    id: randomUUID(),
    listingId,
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
    kind: "setup",
    locale: "en",
    purpose: guide.purpose,
    setupUrl: "https://example.com/payments/signup",
    minPermissions: guide.minPermissions,
    credentialLocation: guide.credentialLocation,
    localTestMd: guide.localTestMd,
    productionMd: guide.productionMd,
    securityNotes: guide.securityNotes,
    costNotes: guide.costNotes,
    commonErrorsMd: guide.commonErrorsMd,
    cleanupMd: guide.cleanupMd,
    docsUrl: "https://example.com/payments/docs",
    testedVersion: guide.testedVersion,
    testEnvironment: guide.testEnvironment,
    compatibilityNotes: guide.compatibilityNotes,
    exampleText: guide.exampleText,
    successMd: guide.successMd,
    revision: 1,
  };
}

function libraryGuides(): GuideRecord[] {
  const base = {
    listingId: null,
    published: true,
    verifiedAt: reviewedAt,
    verifiedBy: "vision-editorial",
    createdAt: reviewedAt,
    updatedAt: reviewedAt,
    locale: "en",
    setupUrl: null,
    docsUrl: null,
    revision: 1,
    exampleText: "",
    minPermissions: "No provider permission is required.",
    credentialLocation: "Nowhere. This lesson does not collect a key.",
    securityNotes: "Do not paste a provider key into Vision API.",
    costNotes: "Reading the directory has no provider charge.",
    testEnvironment: "This monitor and the public directory.",
    testedVersion: "Reviewed 2026-11-01",
  };
  return [
    {
      ...base,
      id: "gde_quickstart",
      slug: "read-a-listing",
      title: "Read a listing",
      summary: "A short path from the directory to a provider page.",
      bodyMd: "Open a listing, read who operates it, and follow the reviewed documentation link.",
      prerequisites: "No account.",
      difficulty: "beginner",
      kind: "quickstart",
      purpose: "Show that a listing is a link, not a connection.",
      localTestMd: "Open the directory and one listing.",
      productionMd: "Keep using the provider's own status page after you adopt it.",
      commonErrorsMd: "A listing does not mean Vision API is calling the provider for you.",
      cleanupMd: "Close the provider tab. Nothing was installed.",
      compatibilityNotes: "Any published listing.",
      successMd: "You can name the provider and the page you opened.",
    },
    {
      ...base,
      id: "gde_owned_vs_provider",
      slug: "provider-failure-vs-owned",
      title: "Tell a provider failure from an owned failure",
      summary: "Use the dependency role for the provider and the owned role for your service.",
      bodyMd: "When the provider status page and your dependency monitor are down, the provider failed. When your owned monitor is down and the dependency is up, the failure is yours.",
      prerequisites: "One owned HTTP monitor and one dependency monitor for the provider status URL.",
      difficulty: "intermediate",
      kind: "tutorial",
      purpose: "Keep provider downtime from being mistaken for your own outage.",
      localTestMd: "Point the dependency monitor at the provider status URL. Leave the token in secretRef on your monitor.",
      productionMd: "Alert on the owned service and the dependency separately.",
      commonErrorsMd: "An owned monitor that calls the provider directly mixes both failures into one incident.",
      cleanupMd: "Pause the dependency monitor if you stop using the provider.",
      compatibilityNotes: "HTTP monitors with roles owned and dependency.",
      successMd: "You can say which monitor would be down for a provider outage, and which would be down for your own service.",
    },
    {
      ...base,
      id: "gde_troubleshoot",
      slug: "provider-up-monitor-down",
      title: "The provider is up and your monitor is down",
      summary: "A troubleshooting path when the status page and your check disagree.",
      bodyMd: "Open the provider status page from the listing. If it is up, inspect your owned service before you treat the provider as down.",
      prerequisites: "The provider status link and your owned monitor.",
      difficulty: "advanced",
      kind: "troubleshooting",
      purpose: "Avoid blaming the provider for a local failure.",
      localTestMd: "Compare the provider status page with the latest check on the owned monitor.",
      productionMd: "Keep the dependency monitor on the provider and the owned monitor on your service.",
      commonErrorsMd: "A private URL, a bad certificate, and an application 500 are different failures.",
      cleanupMd: "Remove a temporary check when the comparison is finished.",
      compatibilityNotes: "Status links that leave through the reviewed redirect.",
      successMd: "You can point to the check that failed and say whether it is the provider or your service.",
    },
    {
      ...base,
      id: "gde_glossary",
      slug: "directory-glossary",
      title: "Directory glossary",
      summary: "The words this directory uses.",
      bodyMd: "Listing: a reviewed link to an external provider. Owned: a service you run. Dependency: a service someone else runs. Secret reference: the name of an environment variable, never the secret itself. Incident: a stretch of failed checks.",
      prerequisites: "None.",
      difficulty: "beginner",
      kind: "glossary",
      purpose: "Keep the directory language stable across languages later.",
      localTestMd: "Read the terms beside a listing.",
      productionMd: "Use the same words in your own runbooks.",
      commonErrorsMd: "Calling a listing a connection. A listing does not hold a credential.",
      cleanupMd: "No account is created. Nothing to revoke.",
      compatibilityNotes: "English (en). The chrome can be translated without changing these definitions.",
      successMd: "You can explain listing, owned, and dependency without mixing them up.",
    },
  ];
}
