import type { DatabaseApi } from "../db/database.js";
import type { AuthContext, StatusPage, StatusVisibility } from "../types/index.js";
import { conflict, forbidden, notFound, validationError } from "../utils/errors.js";
import { requireGroup, requireScope, visibleService } from "../auth/access.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createStatusPage(
  db: DatabaseApi,
  auth: AuthContext,
  input: { groupId: string; slug: string; title: string; visibility: StatusVisibility },
): StatusPage {
  requireScope(auth, "admin");
  const group = db.getGroup(input.groupId);
  if (!group) {
    throw notFound(`Group ${input.groupId} does not exist`);
  }
  requireGroup(auth, group.id);
  const title = input.title.trim();
  const slug = input.slug.trim();
  if (title.length === 0 || title.length > 80) {
    throw validationError("title must be 1 to 80 characters", { title: ["title must be 1 to 80 characters"] });
  }
  if (!SLUG.test(slug) || slug.length > 80) {
    throw validationError("slug must be lowercase words separated by hyphens", {
      slug: ["slug must be lowercase words separated by hyphens"],
    });
  }
  if (input.visibility !== "public" && input.visibility !== "private") {
    throw validationError("visibility must be public or private", { visibility: ["visibility must be public or private"] });
  }
  if (db.getStatusPageBySlug(slug)) {
    throw conflict(`Status page slug ${slug} is already in use`);
  }
  return db.createStatusPage({ groupId: group.id, slug, title, visibility: input.visibility });
}

export function addStatusComponent(
  db: DatabaseApi,
  auth: AuthContext,
  pageId: string,
  input: { serviceId: string; displayName: string; sortOrder?: number },
) {
  requireScope(auth, "admin");
  const page = db.getStatusPage(pageId);
  if (!page) {
    throw notFound(`Status page ${pageId} does not exist`);
  }
  requireGroup(auth, page.groupId);
  const service = visibleService(db, auth, input.serviceId);
  if (service.groupId !== page.groupId) {
    throw forbidden("Service is not in this status page's group");
  }
  if (db.findStatusComponent(page.id, service.id)) {
    throw conflict("Service is already on this status page");
  }
  const displayName = input.displayName.trim();
  if (displayName.length === 0 || displayName.length > 80) {
    throw validationError("displayName must be 1 to 80 characters", {
      displayName: ["displayName must be 1 to 80 characters"],
    });
  }
  return db.addStatusComponent({
    statusPageId: page.id,
    serviceId: service.id,
    displayName,
    sortOrder: input.sortOrder ?? 0,
  });
}
