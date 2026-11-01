import type { DatabaseApi } from "../db/database.js";
import { DEFAULT_GROUP_ID } from "../db/migrations.js";
import type { AuthContext, Group, ServiceStatus } from "../types/index.js";
import { conflict, forbidden, notFound, validationError } from "../utils/errors.js";
import { requireGroup, requireScope } from "../auth/access.js";
import { serviceStatus } from "./readModels.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface GroupView extends Group {
  counts: Record<ServiceStatus | "total", number>;
}

export function listGroups(db: DatabaseApi, auth: AuthContext): Group[] {
  requireScope(auth, "read");
  const groups = db.listGroups();
  if (!auth.groupId) {
    return groups;
  }
  return groups.filter((group) => group.id === auth.groupId);
}

export function getGroupView(db: DatabaseApi, auth: AuthContext, id: string): GroupView {
  requireScope(auth, "read");
  const group = requireOwnedGroup(db, auth, id);
  const counts: GroupView["counts"] = { UP: 0, DEGRADED: 0, DOWN: 0, UNKNOWN: 0, total: 0 };
  for (const service of db.listServices()) {
    if (service.groupId !== group.id) {
      continue;
    }
    counts[serviceStatus(db, service)] += 1;
    counts.total += 1;
  }
  return { ...group, counts };
}

export function createGroup(db: DatabaseApi, auth: AuthContext, input: { name: string; slug?: string }): Group {
  requireScope(auth, "admin");
  if (auth.groupId) {
    throw forbidden("A group-restricted key cannot create groups");
  }
  const name = input.name.trim();
  if (name.length === 0 || name.length > 80) {
    throw validationError("name must be 1 to 80 characters", { name: ["name must be 1 to 80 characters"] });
  }
  const slug = (input.slug ?? slugify(name)).trim();
  if (!SLUG.test(slug) || slug.length > 80) {
    throw validationError("slug must be lowercase words separated by hyphens", {
      slug: ["slug must be lowercase words separated by hyphens"],
    });
  }
  if (db.getGroupBySlug(slug)) {
    throw conflict(`Group slug ${slug} is already in use`);
  }
  return db.createGroup({ name, slug });
}

export function renameGroup(db: DatabaseApi, auth: AuthContext, id: string, name: string): Group {
  requireScope(auth, "admin");
  const group = requireOwnedGroup(db, auth, id);
  const next = name.trim();
  if (next.length === 0 || next.length > 80) {
    throw validationError("name must be 1 to 80 characters", { name: ["name must be 1 to 80 characters"] });
  }
  db.updateGroup(group.id, { name: next });
  return { ...group, name: next };
}

export function removeGroup(db: DatabaseApi, auth: AuthContext, id: string): void {
  requireScope(auth, "admin");
  const group = requireOwnedGroup(db, auth, id);
  if (group.id === DEFAULT_GROUP_ID) {
    throw conflict("The default group cannot be deleted");
  }
  if (db.countServicesInGroup(group.id) > 0) {
    throw conflict("Group still has monitors");
  }
  if (db.countActiveKeysInGroup(group.id) > 0) {
    throw conflict("Group still has API keys");
  }
  db.deleteGroup(group.id);
}

function requireOwnedGroup(db: DatabaseApi, auth: AuthContext, id: string): Group {
  const group = db.getGroup(id);
  if (!group) {
    throw notFound(`Group ${id} does not exist`);
  }
  requireGroup(auth, group.id);
  return group;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}
