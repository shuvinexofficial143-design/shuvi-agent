const LIMITS = Object.freeze({max_items: 10000, max_depth: 32, max_detail_items: 200,
  max_duplicate_groups: 50, max_group_items: 8, max_path_length: 2048, max_extension_keys: 64,
  max_errors: 32, max_result_chars: 48000, max_duration_ms: 10000});
function options(value = {}) {
  const result = {...LIMITS};
  for (const key of Object.keys(value)) {
    if (!["max_items", "max_depth", "max_detail_items"].includes(key) || !Number.isInteger(value[key]) || value[key] < 1 || value[key] > LIMITS[key]) throw new Error("Diagnostics limits must be positive integers within the hard limits.");
    result[key] = value[key];
  }
  return result;
}
function normalizedMediaPath(path) {
  if (typeof path !== "string" || !path || path.length > LIMITS.max_path_length) return null;
  // No dot/junction/Unicode normalization or filename-only matching. Device paths stay unsupported.
  if (/^[\\/]{2}[?.][\\/]/.test(path)) return null;
  if (/^[A-Za-z]:[\\/]/.test(path) || /^[\\/]{2}[^\\/]+[\\/][^\\/]+/.test(path)) {
    return path.replace(/\\/g, "/").replace(/[A-Z]/g, c => c.toLowerCase());
  }
  return path.startsWith("/") ? path : null;
}
function mediaExtension(path) {
  if (typeof path !== "string" || !path || path.length > LIMITS.max_path_length) return "unknown";
  const file = path.split(/[\\/]/).pop();
  const match = /\.([a-zA-Z0-9]{1,16})$/.exec(file);
  return match ? "." + match[1].toLowerCase() : "unknown";
}
async function diagnoseProject(project, adapter, overrides = {}, now = () => Date.now()) {
  const limits = options(overrides), deadline = now() + limits.max_duration_ms;
  const counts = {projectItems: 0, bins: 0, clipItems: 0, mediaItems: 0, sequenceProjectItems: 0, unknownClipKind: 0, otherItems: 0,
    offlineMedia: 0, onlineMedia: 0, offlineUnknown: 0, proxyAttached: 0, noProxy: 0, proxyUnknown: 0, offlineWithAttachedProxy: 0,
    unavailableMediaPaths: 0, readErrors: 0, duplicatePathGroups: 0, repeatedItemIdGroups: 0};
  const report = {schemaVersion: 1, readOnly: true, project: {}, activeSequence: null, totalSequenceCount: null,
    counts, extensions: Object.create(null), mediaDetails: [], duplicatePaths: [], repeatedItemIds: [], errors: [],
    traversal: {complete: true, rootExcludedFromCounts: true, maxDepthVisited: 0, pendingItemsAtStop: 0},
    truncation: {items: false, depth: false, duration: false, details: false, duplicateGroups: false, groupItems: false, paths: false, extensions: false, errors: false, output: false},
    inspectedFieldsComplete: true, truncated: false, limits,
    warnings: ["Counts describe visited items; truncated traversal is not a whole-project total.", "Proxy attachment/path is not proof of proxy availability or health; proxyUsable remains null.", "Duplicate paths are reference candidates, not duplicate files. Windows ASCII case-folding may group paths in case-sensitive directories; verify before any separate repair."]};
  const bounded = (value, limit = 240) => typeof value === "string" && value.length > 0 && value.length <= limit ? value : null;
  const error = (operation, id, e) => {
    counts.readErrors++; report.inspectedFieldsComplete = false;
    if (report.errors.length < limits.max_errors) report.errors.push({operation, id, error: String(e?.message || e).slice(0, 160)});
    else report.truncation.errors = true;
  };
  const read = async (operation, id, fn) => { try { return await fn(); } catch (e) { error(operation, id, e); return null; } };
  const pathValue = value => {
    if (typeof value === "string" && value.length > limits.max_path_length) { report.truncation.paths = true; report.inspectedFieldsComplete = false; return null; }
    if (typeof value === "string" && !value.trim()) return null;
    return bounded(value, limits.max_path_length);
  };
  report.project = {name: bounded(await read("projectName", null, () => project.name)),
    path: pathValue(await read("projectPath", null, () => project.path)), guid: bounded(await read("projectGuid", null, () => adapter.guid(project.guid)))};
  const sequence = await read("activeSequence", null, () => project.getActiveSequence());
  if (sequence) report.activeSequence = {guid: bounded(await read("sequenceGuid", null, () => adapter.guid(sequence.guid))), name: bounded(await read("sequenceName", null, () => sequence.name))};
  const sequences = await read("sequences", null, () => project.getSequences());
  if (Array.isArray(sequences)) report.totalSequenceCount = sequences.length;
  else if (sequences !== null) error("sequences", null, "Native sequence list was not an array.");
  const root = await read("root", null, () => project.getRootItem());
  const stack = [], seenObjects = new WeakSet(), seenFolderIds = new Set(), paths = new Map(), ids = new Map();
  let detailChars = 0;
  async function pushChildren(folder, depth, location, id) {
    if (depth > limits.max_depth) { report.truncation.depth = true; report.traversal.complete = false; return; }
    const children = await read("folderItems", id, () => folder.getItems());
    if (!Array.isArray(children)) { report.traversal.complete = false; if (children !== null) error("folderItems", id, "Native children were not an array."); return; }
    // Hold only one native child-array per depth; never copy or enqueue every sibling.
    if (children.length) stack.push({children, index: 0, depth, location});
  }
  if (root) { seenObjects.add(root); await pushChildren(root, 1, "", null); }
  else report.traversal.complete = false;
  function record(map, key, item) {
    if (!key) return;
    let group = map.get(key);
    if (!group) { group = {count: 0, items: []}; map.set(key, group); }
    group.count++;
    if (group.items.length < limits.max_group_items) group.items.push(item);
  }
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index >= frame.children.length) { stack.pop(); continue; }
    if (counts.projectItems >= limits.max_items || now() >= deadline) {
      report.truncation.items = counts.projectItems >= limits.max_items;
      report.truncation.duration = now() >= deadline; report.traversal.complete = false;
      report.traversal.pendingItemsAtStop = stack.reduce((sum, f) => sum + f.children.length - f.index, 0); break;
    }
    const item = frame.children[frame.index++]; counts.projectItems++;
    report.traversal.maxDepthVisited = Math.max(report.traversal.maxDepthVisited, frame.depth);
    if (!item || typeof item !== "object") { error("item", null, "Invalid native project item."); counts.otherItems++; continue; }
    const repeatedObject = seenObjects.has(item); seenObjects.add(item);
    const id = bounded(await read("itemId", null, () => adapter.id(item)));
    const name = bounded(await read("itemName", id, () => item.name));
    if (!id || !name) report.inspectedFieldsComplete = false;
    const location = bounded(frame.location, limits.max_path_length);
    const identity = {id, name, location}; record(ids, id, identity);
    const folder = await read("folderCast", id, () => adapter.folder(item));
    if (folder) {
      counts.bins++;
      if (repeatedObject || id && seenFolderIds.has(id)) { report.traversal.complete = false; error("folderCycle", id, "Repeated folder reference was not traversed again."); continue; }
      if (id) seenFolderIds.add(id);
      const childLocation = frame.location + "/" + (name || "[unnamed]");
      if (childLocation.length > limits.max_path_length) report.truncation.paths = true;
      await pushChildren(folder, frame.depth + 1, childLocation.slice(0, limits.max_path_length), id); continue;
    }
    const clip = await read("clipCast", id, () => adapter.clip(item));
    if (!clip) { counts.otherItems++; continue; }
    counts.clipItems++;
    const isSequence = await read("isSequence", id, () => clip.isSequence());
    if (isSequence === true) { counts.sequenceProjectItems++; continue; }
    if (isSequence === false) counts.mediaItems++; else { counts.unknownClipKind++; report.inspectedFieldsComplete = false; }
    const mediaPath = pathValue(await read("mediaPath", id, () => clip.getMediaFilePath()));
    if (!mediaPath) { counts.unavailableMediaPaths++; report.inspectedFieldsComplete = false; }
    let offline = await read("offline", id, () => clip.isOffline()); if (typeof offline !== "boolean") offline = null;
    let proxyAttached = await read("hasProxy", id, () => clip.hasProxy()); if (typeof proxyAttached !== "boolean") proxyAttached = null;
    const proxyPath = proxyAttached === true ? pathValue(await read("proxyPath", id, () => clip.getProxyPath())) : null;
    if (offline === null || proxyAttached === null || proxyAttached === true && !proxyPath) report.inspectedFieldsComplete = false;
    counts[offline === true ? "offlineMedia" : offline === false ? "onlineMedia" : "offlineUnknown"]++;
    counts[proxyAttached === true ? "proxyAttached" : proxyAttached === false ? "noProxy" : "proxyUnknown"]++;
    if (offline === true && proxyAttached === true) counts.offlineWithAttachedProxy++;
    let extension = mediaExtension(mediaPath);
    if (!(extension in report.extensions) && Object.keys(report.extensions).length >= limits.max_extension_keys - 1) { extension = "other"; report.truncation.extensions = true; }
    report.extensions[extension] = (report.extensions[extension] || 0) + 1;
    record(paths, normalizedMediaPath(mediaPath), identity);
    const detail = {...identity, mediaPath, offline, proxyAttached, proxyPath, proxyUsable: null, isSequence: typeof isSequence === "boolean" ? isSequence : null};
    const chars = JSON.stringify(detail).length;
    if (report.mediaDetails.length < limits.max_detail_items && detailChars + chars <= 24000) { report.mediaDetails.push(detail); detailChars += chars; }
    else report.truncation.details = true;
  }
  function groups(map, output, kind) {
    for (const [key, group] of map) {
      if (group.count < 2) continue;
      counts[kind === "path" ? "duplicatePathGroups" : "repeatedItemIdGroups"]++;
      if (output.length >= limits.max_duplicate_groups) { report.truncation.duplicateGroups = true; continue; }
      const itemsTruncated = group.count > group.items.length;
      if (itemsTruncated) report.truncation.groupItems = true;
      output.push({[kind]: key, count: group.count, items: group.items, itemsTruncated, candidateOnly: true});
    }
  }
  groups(paths, report.duplicatePaths, "path"); groups(ids, report.repeatedItemIds, "id");
  report.mediaStatusScope = "Clip items not positively identified as sequences; unknownClipKind is included.";
  report.totalProjectItemCount = report.traversal.complete ? counts.projectItems : null;
  report.countsScope = report.traversal.complete ? "visited_complete_tree" : "visited_partial_tree";
  // Reserve space for final detail counters/flags; drop detail, never alter summary counts.
  while (JSON.stringify(report).length > limits.max_result_chars - 512) {
    report.truncation.output = true;
    const list = [report.mediaDetails, report.duplicatePaths, report.repeatedItemIds, report.errors].find(values => values.length);
    if (!list) break;
    list.pop();
  }
  report.detailCounts = {mediaReturned: report.mediaDetails.length, offlineReturned: report.mediaDetails.filter(item => item.offline === true).length,
    omittedMedia: counts.clipItems - counts.sequenceProjectItems - report.mediaDetails.length,
    duplicatePathGroupsReturned: report.duplicatePaths.length, repeatedItemIdGroupsReturned: report.repeatedItemIds.length};
  report.truncated = Object.values(report.truncation).some(Boolean) || !report.traversal.complete;
  return report;
}
module.exports = {LIMITS, options, normalizedMediaPath, mediaExtension, diagnoseProject};
