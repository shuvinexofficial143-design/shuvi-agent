"use strict";
// Premiere 25.6+ official UXP Project.createProject/Open workflow.
// All on-disk path, collision and audit authority lives in Rust. This host
// adapter reports what Adobe actually returned; it never certifies bytes.
function normalize(path) {
  return String(path || "").replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();
}
function checkedPath(value) {
  if (typeof value !== "string" || value.trim() !== value ||
      value.length < 9 || value.length > 4096 ||
      /[\x00-\x1f\x7f]/.test(value) ||
      !(/^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)) ||
      !/\.prproj$/i.test(value) || /(?:^|[\\/])\.\.?[\\/]/.test(value)) {
    throw new Error("Project path must be a clean absolute Windows .prproj path.");
  }
  return value;
}
async function inspectResult(projectApi, target, project, plainGuid, operation, before) {
  const active = await projectApi.getActiveProject();
  const projectGuid = project ? plainGuid(project.guid) : null;
  const activeGuid = active ? plainGuid(active.guid) : null;
  const projectPath = project?.path || null;
  const activePath = active?.path || null;
  const verified = Boolean(projectGuid) && Boolean(activeGuid) &&
    projectGuid === activeGuid && normalize(projectPath) === normalize(target) &&
    normalize(activePath) === normalize(target);
  return {
    operation,
    hostAccepted: Boolean(project),
    projectGuid, projectPath, activeGuid, activePath,
    priorActiveGuid: before ? plainGuid(before.guid) : null,
    priorActivePath: before?.path || null,
    projectIdentityVerified: verified,
    verificationStatus: verified ? "verified_host_identity" : "accepted_unverified",
    persistenceVerified: false, reopenVerified: false,
    uncertain: !verified, retrySafe: false
  };
}
async function createProject(projectApi, input, plainGuid) {
  const path = checkedPath(input?.path);
  if (typeof projectApi?.createProject !== "function")
    throw new Error("Installed Premiere does not expose Project.createProject.");
  const before = await projectApi.getActiveProject();
  const project = await projectApi.createProject(path);
  if (!project) throw new Error("Premiere project creation did not return a project; inspect host before retry.");
  // Explicit save is needed for durable byte evidence. A failed save must not
  // prompt a second create: the host may have already created an open project.
  const saved = await project.save();
  if (saved !== true)
    throw new Error("Premiere created a project but its initial save is uncertain; inspect before retrying.");
  const evidence = await inspectResult(projectApi, path, project, plainGuid, "create", before);
  return {...evidence, initialSaveAccepted: true};
}
async function openProject(projectApi, input, plainGuid) {
  const path = checkedPath(input?.path);
  if (typeof projectApi?.open !== "function")
    throw new Error("Installed Premiere does not expose Project.open.");
  const before = await projectApi.getActiveProject();
  const project = await projectApi.open(path);
  if (!project) throw new Error("Premiere open returned no project; inspect before retrying.");
  const evidence = await inspectResult(projectApi, path, project, plainGuid, "open", before);
  return {...evidence, initialSaveAccepted: false};
}
module.exports = {checkedPath,createProject,openProject};
