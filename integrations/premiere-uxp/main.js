const { entrypoints, host, versions } = require("uxp");
const premiere = require("premierepro");
const { planSpeed, SPEED_CAPABILITY } = require("./speed-workflows.js");

const BRIDGE_BASE = "http://127.0.0.1:17361";
let bridgeToken = "";
let pollTimer = null;
let busy = false;
let activeExpectation = null;

function el(id) {
  return document.getElementById(id);
}

function show(value) {
  const output = el("output");
  if (output) output.textContent = value;
}

function setStatus(text, connected = false) {
  const status = el("bridgeStatus");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("connected", connected);
}

async function bridgeFetch(path, options = {}, timeoutMs = 2500, sessionToken = bridgeToken) {
  if (!sessionToken) throw new Error("Enter the Shuvi pairing token first.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(BRIDGE_BASE + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Shuvi-Token": sessionToken,
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : null;

    if (!response.ok) {
      throw new Error(body?.error || "Bridge returned HTTP " + response.status);
    }

    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function plainGuid(value) {
  if (value == null) return null;
  const text = String(value);
  return text && text !== "[object Object]" ? text : null;
}

function plainTickTime(value) {
  if (!value) return null;
  return {
    seconds: typeof value.seconds === "number" ? value.seconds : null,
    ticks: typeof value.ticks === "string" ? value.ticks : null
  };
}

function plainFrameSize(value) {
  if (!value) return null;
  return {
    x: typeof value.x === "number" ? value.x : null,
    y: typeof value.y === "number" ? value.y : null,
    width: typeof value.width === "number" ? value.width : null,
    height: typeof value.height === "number" ? value.height : null
  };
}

async function requireProject() {
  const project = await premiere.Project.getActiveProject();
  if (!project) throw new Error("No active Premiere project.");
  if (activeExpectation) await assertExpectedProject(project, activeExpectation);
  return project;
}

async function assertExpectedProject(project, expected) {
  if (!expected.project_guid || plainGuid(project.guid) !== expected.project_guid ||
      (expected.project_path != null && project.path !== expected.project_path)) {
    throw new Error("Expected Premiere project changed. Inspect again before editing.");
  }
  const sequence = await project.getActiveSequence();
  if (expected.sequence_guid != null && plainGuid(sequence?.guid) !== expected.sequence_guid) {
    throw new Error("Expected Premiere sequence changed. Inspect again before editing.");
  }
  return sequence;
}

async function clipTargetSignature(project, sequence, item, kind, track, clipIndex) {
  const [name, start, end, input, output, media] = await Promise.all([
    item.getName(), item.getStartTime(), item.getEndTime(), item.getInPoint(), item.getOutPoint(), item.getProjectItem()
  ]);
  const projectGuid = plainGuid(project.guid), sequenceGuid = plainGuid(sequence.guid);
  const times = [start, end, input, output].map(time => plainTickTime(time)?.ticks);
  const mediaId = await projectItemId(media);
  if (!projectGuid || !sequenceGuid || !mediaId || times.some(time => time == null)) {
    throw new Error("Native clip identity is unavailable; inspect a supported target.");
  }
  const signature = JSON.stringify([projectGuid, project.path || null, sequenceGuid, kind, track, clipIndex, mediaId, name, ...times]);
  if (signature.length > 4096) throw new Error("Native clip identity exceeds the supported bound.");
  return signature;
}

function commandClipTargets(command) {
  const args = command.arguments || {};
  if (command.action === "create_subsequence") return args.targets || [];
  if (command.action === "roll_edit") return [
    {kind: args.kind, track: args.track, clipIndex: args.leftClipIndex},
    {kind: args.kind, track: args.track, clipIndex: args.rightClipIndex}
  ];
  return Number.isInteger(args.clipIndex) ? [{kind: args.kind || (command.action.includes("audio") ? "audio" : "video"), track: args.track, clipIndex: args.clipIndex}] : [];
}

async function assertExpectedTargets(command) {
  const expected = command.arguments?._expected;
  if (expected == null) return;
  const project = await requireProject();
  const sequence = await assertExpectedProject(project, expected);
  const clips = expected.clips || [];
  if (!Array.isArray(clips) || clips.length > 64 || (clips.length && !expected.sequence_guid)) {
    throw new Error("Invalid clip expectations.");
  }
  if (clips.length) for (const target of commandClipTargets(command)) {
    if (!clips.some(clip => clip.kind === target.kind && clip.track === target.track && clip.clip_index === target.clipIndex)) {
      throw new Error("Clip expectations do not cover the command target.");
    }
  }
  for (const clip of clips) {
    const {item} = await resolveSubsequenceTarget(sequence, {kind: clip.kind, track: clip.track, clipIndex: clip.clip_index});
    const signature = await clipTargetSignature(project, sequence, item, clip.kind, clip.track, clip.clip_index);
    if (signature !== clip.signature) throw new Error("Expected Premiere clip changed. Inspect again before editing.");
  }
}

async function executeCommand(command) {
  const previous = activeExpectation;
  activeExpectation = command.arguments?._expected || null;
  try {
    await assertExpectedTargets(command);
    return await dispatchNativeCommand(command);
  } finally {
    activeExpectation = previous;
  }
}

async function inspectActiveContext() {
  const project = await premiere.Project.getActiveProject();

  if (!project) {
    return {
      capabilities: { targetExpectations: 1 },
    premiereVersion: host?.version || null,
      uxpVersion: versions?.uxp || null,
      projectDetected: false,
      sequenceDetected: false
    };
  }

  const sequence = await project.getActiveSequence();
  const sequences = await project.getSequences();
  let sequenceInfo = null;

  if (sequence) {
    const [
      videoTracks,
      audioTracks,
      captionTracks,
      frameSize,
      playerPosition,
      endTime
    ] = await Promise.all([
      sequence.getVideoTrackCount(),
      sequence.getAudioTrackCount(),
      sequence.getCaptionTrackCount(),
      sequence.getFrameSize(),
      sequence.getPlayerPosition(),
      sequence.getEndTime()
    ]);

    sequenceInfo = {
      guid: plainGuid(sequence.guid),
      name: sequence.name || null,
      videoTracks,
      audioTracks,
      captionTracks,
      frameSize: plainFrameSize(frameSize),
      playerPosition: plainTickTime(playerPosition),
      endTime: plainTickTime(endTime)
    };
  }

  return {
    capabilities: { targetExpectations: 1 },
    premiereVersion: host?.version || null,
    uxpVersion: versions?.uxp || null,
    projectDetected: true,
    projectGuid: plainGuid(project.guid),
    projectName: project.name || null,
    projectPath: project.path || null,
    sequenceDetected: Boolean(sequence),
    activeSequence: sequenceInfo,
    sequenceCount: Array.isArray(sequences) ? sequences.length : 0
  };
}

async function listRootItems() {
  const project = await requireProject();
  const root = await project.getRootItem();
  const items = await root.getItems();

  const rows = [];
  for (const item of items.slice(0, 250)) {
    let id = null;
    try {
      id = await item.getId();
    } catch {
      id = null;
    }

    rows.push({
      id,
      name: item.name || null,
      type: item.type ?? null
    });
  }

  return {
    projectName: project.name || null,
    count: items.length,
    truncated: items.length > 250,
    items: rows
  };
}

async function createBin(argumentsValue) {
  const name =
    typeof argumentsValue?.name === "string"
      ? argumentsValue.name.trim()
      : "";

  if (!name) throw new Error("Bin name is required.");
  if (name.length > 120) throw new Error("Bin name is too long.");

  const project = await requireProject();
  const root = await project.getRootItem();

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = root.createBinAction(name, true);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Create Bin");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere could not create the requested bin.");
  }

  const items = await root.getItems();
  const bins = items
    .filter((item) => typeof item?.name === "string" && item.name.toLowerCase().startsWith(name.toLowerCase()))
    .map((item) => ({
      name: item.name,
      type: item.type ?? null
    }));

  return {
    created: true,
    requestedName: name,
    matchingRootItems: bins.slice(-10)
  };
}

async function importMedia(argumentsValue) {
  const paths = Array.isArray(argumentsValue?.paths)
    ? argumentsValue.paths.filter((value) => typeof value === "string" && value.trim())
    : [];

  if (!paths.length) throw new Error("No media paths were supplied.");
  if (paths.length > 100) throw new Error("A maximum of 100 files can be imported per command.");

  const project = await requireProject();
  const root = await project.getRootItem();
  const success = await project.importFiles(paths, true, root, false);

  if (!success) throw new Error("Premiere reported that media import did not complete.");

  return {
    imported: paths.length,
    projectName: project.name || null
  };
}

function normalizeMediaPath(value) {
  return String(value || "")
    .replaceAll("/", "\\")
    .replace(/\\+$/, "")
    .toLowerCase();
}

async function collectClipMedia(folder, output, depth = 0) {
  if (depth > 8 || output.length >= 1000) return;

  const items = await folder.getItems();

  for (const item of items) {
    if (output.length >= 1000) break;

    try {
      const clip = premiere.ClipProjectItem.cast(item);
      const mediaPath = await clip.getMediaFilePath();

      if (mediaPath) {
        output.push({
          clip,
          mediaPath,
          normalizedPath: normalizeMediaPath(mediaPath),
          name: clip.name || item.name || null
        });
        continue;
      }
    } catch {
      // Not a media clip.
    }

    try {
      const childFolder = premiere.FolderItem.cast(item);
      await collectClipMedia(childFolder, output, depth + 1);
    } catch {
      // Not a folder.
    }
  }
}

async function findClipItemsForPaths(project, root, paths) {
  const wanted = new Map(paths.map((path) => [normalizeMediaPath(path), path]));
  const media = [];
  await collectClipMedia(root, media);

  const matches = new Map();
  for (const item of media) {
    if (wanted.has(item.normalizedPath) && !matches.has(item.normalizedPath)) {
      matches.set(item.normalizedPath, item.clip);
    }
  }

  return {
    clips: paths
      .map((path) => matches.get(normalizeMediaPath(path)))
      .filter(Boolean),
    missing: paths.filter((path) => !matches.has(normalizeMediaPath(path)))
  };
}

async function createSequenceFromMedia(argumentsValue) {
  const name =
    typeof argumentsValue?.name === "string"
      ? argumentsValue.name.trim()
      : "";
  const paths = Array.isArray(argumentsValue?.paths)
    ? argumentsValue.paths.filter((value) => typeof value === "string" && value.trim())
    : [];

  if (!name) throw new Error("Sequence name is required.");
  if (!paths.length) throw new Error("At least one media path is required.");
  if (paths.length > 50) throw new Error("A maximum of 50 media files can be used per sequence command.");

  const project = await requireProject();
  const root = await project.getRootItem();

  let resolved = await findClipItemsForPaths(project, root, paths);

  if (resolved.missing.length) {
    const imported = await project.importFiles(resolved.missing, true, root, false);
    if (!imported) throw new Error("Premiere could not import all missing media.");
    resolved = await findClipItemsForPaths(project, root, paths);
  }

  if (resolved.missing.length) {
    throw new Error(
      "Premiere could not resolve imported media: " + resolved.missing.join(", ")
    );
  }

  const sequence = await project.createSequenceFromMedia(
    name,
    resolved.clips,
    root
  );

  if (!sequence) throw new Error("Premiere did not return the created sequence.");

  await project.setActiveSequence(sequence);

  return {
    created: true,
    sequenceGuid: plainGuid(sequence.guid),
    sequenceName: sequence.name || name,
    mediaCount: resolved.clips.length
  };
}

async function saveProject() {
  const project = await requireProject();
  const success = await project.save();
  if (!success) throw new Error("Premiere could not save the active project.");
  return {
    saved: true,
    projectName: project.name || null,
    projectPath: project.path || null
  };
}

async function sortedClipItems(track) {
  const items = await track.getTrackItems(
    premiere.Constants.TrackItemType.CLIP,
    false
  );

  const timed = [];
  for (const item of items) {
    const start = await item.getStartTime();
    timed.push({
      item,
      startSeconds: start?.seconds ?? Number.POSITIVE_INFINITY
    });
  }

  timed.sort((a, b) => a.startSeconds - b.startSeconds);
  return timed.map((entry) => entry.item);
}

async function summarizeTrackItem(item, clipIndex, context = null) {
  const [
    name,
    start,
    end,
    duration,
    speed,
    disabled,
    trackIndex
  ] = await Promise.all([
    item.getName(),
    item.getStartTime(),
    item.getEndTime(),
    item.getDuration(),
    item.getSpeed(),
    item.isDisabled(),
    item.getTrackIndex()
  ]);

  let targetSignature = null;
  if (context) {
    try { targetSignature = await clipTargetSignature(context.project, context.sequence, item, context.kind, trackIndex, clipIndex); } catch {}
  }
  return {
    targetSignature,
    clipIndex,
    name,
    trackIndex,
    startSeconds: start?.seconds ?? null,
    endSeconds: end?.seconds ?? null,
    durationSeconds: duration?.seconds ?? null,
    speed,
    disabled
  };
}

async function inspectTimeline() {
  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const videoTrackCount = await sequence.getVideoTrackCount();
  const audioTrackCount = await sequence.getAudioTrackCount();
  const videoTracks = [];
  const audioTracks = [];
  let itemBudget = 240;

  for (let index = 0; index < videoTrackCount && itemBudget > 0; index += 1) {
    const track = await sequence.getVideoTrack(index);
    const items = await sortedClipItems(track);
    const summaries = [];

    for (const [clipIndex, item] of items.slice(0, itemBudget).entries()) {
      summaries.push(await summarizeTrackItem(item, clipIndex, {project, sequence, kind: "video"}));
      itemBudget -= 1;
      if (itemBudget <= 0) break;
    }

    videoTracks.push({
      index,
      name: track.name || null,
      muted: await track.isMuted(),
      items: summaries
    });
  }

  for (let index = 0; index < audioTrackCount && itemBudget > 0; index += 1) {
    const track = await sequence.getAudioTrack(index);
    const items = await sortedClipItems(track);
    const summaries = [];

    for (const [clipIndex, item] of items.slice(0, itemBudget).entries()) {
      summaries.push(await summarizeTrackItem(item, clipIndex, {project, sequence, kind: "audio"}));
      itemBudget -= 1;
      if (itemBudget <= 0) break;
    }

    audioTracks.push({
      index,
      name: track.name || null,
      muted: await track.isMuted(),
      items: summaries
    });
  }

  return {
    sequenceGuid: plainGuid(sequence.guid),
    sequenceName: sequence.name || null,
    expected: {project_guid: plainGuid(project.guid), project_path: project.path || null, sequence_guid: plainGuid(sequence.guid), clips: []},
    truncated: itemBudget <= 0,
    videoTracks,
    audioTracks
  };
}

async function resolveOneClip(project, root, path) {
  let resolved = await findClipItemsForPaths(project, root, [path]);

  if (resolved.missing.length) {
    const imported = await project.importFiles([path], true, root, false);
    if (!imported) throw new Error("Premiere could not import the media file.");
    resolved = await findClipItemsForPaths(project, root, [path]);
  }

  if (resolved.missing.length || !resolved.clips[0]) {
    throw new Error("Premiere could not resolve media after import: " + path);
  }

  return resolved.clips[0];
}

async function insertMedia(argumentsValue) {
  const path =
    typeof argumentsValue?.path === "string"
      ? argumentsValue.path.trim()
      : "";
  const seconds = Number(argumentsValue?.seconds ?? 0);
  const videoTrack = Number(argumentsValue?.videoTrack ?? 0);
  const audioTrack = Number(argumentsValue?.audioTrack ?? 0);
  const mode =
    typeof argumentsValue?.mode === "string"
      ? argumentsValue.mode.toLowerCase()
      : "insert";

  if (!path) throw new Error("Media path is required.");
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Timeline seconds must be zero or greater.");
  if (!Number.isInteger(videoTrack) || videoTrack < 0) throw new Error("Video track index must be a non-negative integer.");
  if (!Number.isInteger(audioTrack) || audioTrack < 0) throw new Error("Audio track index must be a non-negative integer.");
  if (mode !== "insert" && mode !== "overwrite") throw new Error("Mode must be insert or overwrite.");

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const root = await project.getRootItem();
  const clip = await resolveOneClip(project, root, path);
  const projectItem = premiere.ProjectItem.cast(clip);
  const editor = premiere.SequenceEditor.getEditor(sequence);
  const time = premiere.TickTime.createWithSeconds(seconds);

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action =
      mode === "insert"
        ? editor.createInsertProjectItemAction(
            projectItem,
            time,
            videoTrack,
            audioTrack,
            true
          )
        : editor.createOverwriteItemAction(
            projectItem,
            time,
            videoTrack,
            audioTrack
          );

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, mode === "insert" ? "Shuvi: Insert Media" : "Shuvi: Overwrite Media");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the timeline edit transaction.");
  }

  return {
    edited: true,
    mode,
    path,
    sequenceName: sequence.name || null,
    seconds,
    videoTrack,
    audioTrack
  };
}

async function trimClip(argumentsValue) {
  const kind =
    typeof argumentsValue?.kind === "string"
      ? argumentsValue.kind.toLowerCase()
      : "";
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const startSeconds =
    argumentsValue?.startSeconds == null
      ? null
      : Number(argumentsValue.startSeconds);
  const endSeconds =
    argumentsValue?.endSeconds == null
      ? null
      : Number(argumentsValue.endSeconds);

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Trim kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }
  if (startSeconds == null && endSeconds == null) {
    throw new Error("Provide startSeconds and/or endSeconds.");
  }
  if (startSeconds != null && (!Number.isFinite(startSeconds) || startSeconds < 0)) {
    throw new Error("startSeconds must be zero or greater.");
  }
  if (endSeconds != null && (!Number.isFinite(endSeconds) || endSeconds < 0)) {
    throw new Error("endSeconds must be zero or greater.");
  }
  if (startSeconds != null && endSeconds != null && startSeconds >= endSeconds) {
    throw new Error("startSeconds must be earlier than endSeconds.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on " + kind + " track " + trackIndex + "."
    );
  }

  const currentStart = await item.getStartTime();
  const currentEnd = await item.getEndTime();
  const nextStart = startSeconds == null ? currentStart?.seconds : startSeconds;
  const nextEnd = endSeconds == null ? currentEnd?.seconds : endSeconds;

  if (
    typeof nextStart !== "number" ||
    typeof nextEnd !== "number" ||
    nextStart >= nextEnd
  ) {
    throw new Error("Requested trim would create an invalid clip duration.");
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const actions = [];

    if (startSeconds != null) {
      actions.push(
        item.createSetStartAction(
          premiere.TickTime.createWithSeconds(startSeconds)
        )
      );
    }

    if (endSeconds != null) {
      actions.push(
        item.createSetEndAction(
          premiere.TickTime.createWithSeconds(endSeconds)
        )
      );
    }

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      for (const action of actions) compoundAction.addAction(action);
    }, "Shuvi: Trim Clip");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the trim transaction.");
  }

  return {
    trimmed: true,
    kind,
    track: trackIndex,
    clipIndex,
    startSeconds: nextStart,
    endSeconds: nextEnd
  };
}

async function moveClip(argumentsValue) {
  const kind =
    typeof argumentsValue?.kind === "string"
      ? argumentsValue.kind.toLowerCase()
      : "";
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const deltaSeconds = Number(argumentsValue?.deltaSeconds);

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Move kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }
  if (!Number.isFinite(deltaSeconds) || deltaSeconds === 0 || Math.abs(deltaSeconds) > 36000) {
    throw new Error("deltaSeconds must be finite, non-zero and within ±10 hours.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on " + kind + " track " + trackIndex + "."
    );
  }

  const before = await item.getStartTime();
  const nextStart = (before?.seconds ?? 0) + deltaSeconds;
  if (nextStart < 0) {
    throw new Error("Move would place the clip before sequence time zero.");
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = item.createMoveAction(
      premiere.TickTime.createWithSeconds(deltaSeconds)
    );
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Move Clip");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the clip move transaction.");
  }

  return {
    moved: true,
    kind,
    track: trackIndex,
    clipIndex,
    deltaSeconds,
    previousStartSeconds: before?.seconds ?? null,
    newStartSeconds: nextStart
  };
}

async function deleteClip(argumentsValue) {
  const kind =
    typeof argumentsValue?.kind === "string"
      ? argumentsValue.kind.toLowerCase()
      : "";
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const ripple = Boolean(argumentsValue?.ripple);

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Delete kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on " + kind + " track " + trackIndex + "."
    );
  }

  const editor = premiere.SequenceEditor.getEditor(sequence);
  const mediaType =
    kind === "video"
      ? premiere.Constants.MediaType.VIDEO
      : premiere.Constants.MediaType.AUDIO;

  let selectionCreated = false;
  let transactionSucceeded = false;

  premiere.TrackItemSelection.createEmptySelection((selection) => {
    selectionCreated = selection.addItem(item, false);
    if (!selectionCreated) return;

    project.lockedAccess(() => {
      const action = editor.createRemoveItemsAction(
        selection,
        ripple,
        mediaType,
        true
      );

      transactionSucceeded = project.executeTransaction((compoundAction) => {
        compoundAction.addAction(action);
      }, ripple ? "Shuvi: Ripple Delete Clip" : "Shuvi: Delete Clip");
    });
  });

  if (!selectionCreated) {
    throw new Error("Premiere could not create a temporary selection for the clip.");
  }
  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the delete transaction.");
  }

  return {
    deleted: true,
    ripple,
    kind,
    track: trackIndex,
    clipIndex
  };
}

async function exportSequence(argumentsValue) {
  const output =
    typeof argumentsValue?.output === "string"
      ? argumentsValue.output.trim()
      : "";
  const preset =
    typeof argumentsValue?.preset === "string"
      ? argumentsValue.preset.trim()
      : "";
  const queueToAme = Boolean(argumentsValue?.queueToAme);

  if (!output) throw new Error("Export output path is required.");

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const manager = premiere.EncoderManager.getManager();

  if (queueToAme && !manager.isAMEInstalled) {
    throw new Error("Adobe Media Encoder is not installed.");
  }

  const exportType = queueToAme
    ? premiere.Constants.ExportType.QUEUE_TO_AME
    : premiere.Constants.ExportType.IMMEDIATELY;

  const success = await manager.exportSequence(
    sequence,
    exportType,
    output,
    preset,
    true
  );

  if (!success) {
    throw new Error("Premiere rejected the export request.");
  }

  return {
    accepted: true,
    sequenceName: sequence.name || null,
    output,
    preset: preset || null,
    queueToAme,
    ameInstalled: Boolean(manager.isAMEInstalled)
  };
}

async function setPlayhead(argumentsValue) {
  const seconds = Number(argumentsValue?.seconds);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("Playhead seconds must be between 0 and 86400.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const success = await sequence.setPlayerPosition(
    premiere.TickTime.createWithSeconds(seconds)
  );

  if (!success) throw new Error("Premiere could not move the playhead.");

  return {
    moved: true,
    sequenceName: sequence.name || null,
    seconds
  };
}

async function setTrackMute(argumentsValue) {
  const kind =
    typeof argumentsValue?.kind === "string"
      ? argumentsValue.kind.toLowerCase()
      : "";
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const muted = Boolean(argumentsValue?.muted);

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Track kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Track index must be a non-negative integer.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere track was not found.");

  const success = await track.setMute(muted);
  if (!success) throw new Error("Premiere could not change the track mute state.");

  return {
    changed: true,
    kind,
    track: trackIndex,
    muted
  };
}

async function setClipEnabled(argumentsValue) {
  const kind =
    typeof argumentsValue?.kind === "string"
      ? argumentsValue.kind.toLowerCase()
      : "";
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const enabled = argumentsValue?.enabled;

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Clip kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }
  if (typeof enabled !== "boolean") {
    throw new Error("enabled must be a boolean.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on " + kind + " track " + trackIndex + "."
    );
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = item.createSetDisabledAction(!enabled);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, enabled ? "Shuvi: Enable Clip" : "Shuvi: Disable Clip");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the clip enable/disable transaction.");
  }

  return {
    changed: true,
    kind,
    track: trackIndex,
    clipIndex,
    enabled
  };
}

async function listVideoTransitions() {
  const matchNames = await premiere.TransitionFactory.getVideoTransitionMatchNames();
  const values = Array.isArray(matchNames) ? matchNames : [];

  return {
    count: values.length,
    transitions: values.slice(0, 1000)
  };
}

async function addVideoTransition(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const matchName =
    typeof argumentsValue?.matchName === "string"
      ? argumentsValue.matchName.trim()
      : "";
  const durationSeconds = Number(argumentsValue?.durationSeconds);
  const position =
    typeof argumentsValue?.position === "string"
      ? argumentsValue.position.toLowerCase()
      : "";
  const forceSingleSided = Boolean(argumentsValue?.forceSingleSided);

  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Video track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }
  if (!matchName) throw new Error("Transition matchName is required.");
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 60) {
    throw new Error("Transition duration must be greater than 0 and at most 60 seconds.");
  }
  if (position !== "start" && position !== "end") {
    throw new Error("Transition position must be start or end.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track = await sequence.getVideoTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere video track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on video track " + trackIndex + "."
    );
  }

  const installed = await premiere.TransitionFactory.getVideoTransitionMatchNames();
  if (!installed.includes(matchName)) {
    throw new Error("Installed Premiere transition was not found: " + matchName);
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const transition = premiere.TransitionFactory.createVideoTransition(matchName);
    const options = new premiere.AddTransitionOptions()
      .setApplyToStart(position === "start")
      .setDuration(premiere.TickTime.createWithSeconds(durationSeconds))
      .setForceSingleSided(forceSingleSided);

    const action = item.createAddVideoTransitionAction(
      transition,
      options
    );

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Add Video Transition");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the video transition transaction.");
  }

  return {
    added: true,
    track: trackIndex,
    clipIndex,
    matchName,
    durationSeconds,
    position,
    forceSingleSided
  };
}

function plainEffectValue(value) {
  if (value == null) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 32).map(plainEffectValue);
  if (typeof value === "object") {
    const result = {};
    for (const [key, entry] of Object.entries(value).slice(0, 32)) {
      const plain = plainEffectValue(entry);
      if (plain !== undefined) result[key] = plain;
    }
    return result;
  }
  return String(value);
}

async function getVideoClipTarget(trackIndex, clipIndex) {
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Video track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track = await sequence.getVideoTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere video track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on video track " + trackIndex + "."
    );
  }

  return { project, sequence, track, item };
}

async function listVideoEffects() {
  const [matchNames, displayNames] = await Promise.all([
    premiere.VideoFilterFactory.getMatchNames(),
    premiere.VideoFilterFactory.getDisplayNames()
  ]);

  const matches = Array.isArray(matchNames) ? matchNames : [];
  const displays = Array.isArray(displayNames) ? displayNames : [];

  return {
    count: matches.length,
    truncated: matches.length > 1500,
    effects: matches.slice(0, 1500).map((matchName, index) => ({
      matchName,
      displayName: displays[index] || null
    }))
  };
}

async function inspectClipEffects(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const { item } = await getVideoClipTarget(trackIndex, clipIndex);
  const chain = await item.getComponentChain();
  const componentCount = await chain.getComponentCount();
  const components = [];

  for (let componentIndex = 0; componentIndex < componentCount && componentIndex < 128; componentIndex += 1) {
    const component = await chain.getComponentAtIndex(componentIndex);
    const [matchName, displayName] = await Promise.all([
      component.getMatchName(),
      component.getDisplayName()
    ]);
    const paramCount = await component.getParamCount();
    const params = [];

    for (let paramIndex = 0; paramIndex < paramCount && paramIndex < 128; paramIndex += 1) {
      const param = await component.getParam(paramIndex);
      let startValue = null;
      let keyframesSupported = false;
      let timeVarying = false;
      let keyframeCount = 0;

      try {
        const start = await param.getStartValue();
        startValue = plainEffectValue(start?.value ?? start);
      } catch {
        startValue = null;
      }

      try {
        keyframesSupported = Boolean(await param.areKeyframesSupported());
      } catch {
        keyframesSupported = false;
      }

      try {
        timeVarying = Boolean(await param.isTimeVarying());
      } catch {
        timeVarying = false;
      }

      if (keyframesSupported) {
        try {
          const times = await param.getKeyframeListAsTickTimes();
          keyframeCount = Array.isArray(times) ? times.length : 0;
        } catch {
          keyframeCount = 0;
        }
      }

      params.push({
        paramIndex,
        displayName: param.displayName || null,
        startValue,
        keyframesSupported,
        timeVarying,
        keyframeCount
      });
    }

    components.push({
      componentIndex,
      matchName,
      displayName,
      paramCount,
      params,
      paramsTruncated: paramCount > 128
    });
  }

  return {
    track: trackIndex,
    clipIndex,
    componentCount,
    components,
    componentsTruncated: componentCount > 128
  };
}

async function addVideoEffect(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const matchName =
    typeof argumentsValue?.matchName === "string"
      ? argumentsValue.matchName.trim()
      : "";

  if (!matchName) throw new Error("Video effect matchName is required.");

  const installed = await premiere.VideoFilterFactory.getMatchNames();
  if (!Array.isArray(installed) || !installed.includes(matchName)) {
    throw new Error("Installed Premiere video effect was not found: " + matchName);
  }

  const { project, item } = await getVideoClipTarget(trackIndex, clipIndex);
  const chain = await item.getComponentChain();
  const component = await premiere.VideoFilterFactory.createComponent(matchName);

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = chain.createAppendComponentAction(component);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Add Video Effect");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the video effect transaction.");
  }

  return {
    added: true,
    track: trackIndex,
    clipIndex,
    matchName
  };
}

async function resolveEffectParam(trackIndex, clipIndex, componentIndex, paramIndex) {
  if (!Number.isInteger(componentIndex) || componentIndex < 0) {
    throw new Error("Component index must be a non-negative integer.");
  }
  if (!Number.isInteger(paramIndex) || paramIndex < 0) {
    throw new Error("Parameter index must be a non-negative integer.");
  }

  const target = await getVideoClipTarget(trackIndex, clipIndex);
  const chain = await target.item.getComponentChain();
  const componentCount = await chain.getComponentCount();
  if (componentIndex >= componentCount) {
    throw new Error("Requested effect component index was not found.");
  }

  const component = await chain.getComponentAtIndex(componentIndex);
  const paramCount = await component.getParamCount();
  if (paramIndex >= paramCount) {
    throw new Error("Requested effect parameter index was not found.");
  }

  const param = await component.getParam(paramIndex);
  return { ...target, component, param };
}

async function setEffectParam(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const componentIndex = Number(argumentsValue?.componentIndex ?? 0);
  const paramIndex = Number(argumentsValue?.paramIndex ?? 0);
  const value = argumentsValue?.value;

  const { project, component, param } = await resolveEffectParam(
    trackIndex,
    clipIndex,
    componentIndex,
    paramIndex
  );

  if (await param.isTimeVarying()) {
    throw new Error("This parameter is time-varying. Use the keyframe command instead.");
  }

  const keyframe = await param.createKeyframe(value);
  let transactionSucceeded = false;

  project.lockedAccess(() => {
    const action = param.createSetValueAction(keyframe, true);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Set Effect Parameter");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the effect parameter transaction.");
  }

  return {
    changed: true,
    track: trackIndex,
    clipIndex,
    componentIndex,
    paramIndex,
    componentMatchName: await component.getMatchName(),
    paramDisplayName: param.displayName || null,
    value: plainEffectValue(value)
  };
}

async function addEffectKeyframe(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const componentIndex = Number(argumentsValue?.componentIndex ?? 0);
  const paramIndex = Number(argumentsValue?.paramIndex ?? 0);
  const seconds = Number(argumentsValue?.seconds);
  const value = argumentsValue?.value;

  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("Keyframe seconds must be between 0 and 86400.");
  }

  const { project, component, param } = await resolveEffectParam(
    trackIndex,
    clipIndex,
    componentIndex,
    paramIndex
  );

  if (!(await param.areKeyframesSupported())) {
    throw new Error("This Premiere effect parameter does not support keyframes.");
  }

  const keyframe = await param.createKeyframe(value);
  keyframe.position = premiere.TickTime.createWithSeconds(seconds);
  const alreadyTimeVarying = Boolean(await param.isTimeVarying());

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      if (!alreadyTimeVarying) {
        compoundAction.addAction(param.createSetTimeVaryingAction(true));
      }
      compoundAction.addAction(param.createAddKeyframeAction(keyframe));
    }, "Shuvi: Add Effect Keyframe");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the effect keyframe transaction.");
  }

  return {
    added: true,
    track: trackIndex,
    clipIndex,
    componentIndex,
    paramIndex,
    componentMatchName: await component.getMatchName(),
    paramDisplayName: param.displayName || null,
    seconds,
    value: plainEffectValue(value)
  };
}

async function getAudioClipTarget(trackIndex, clipIndex) {
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Audio track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track = await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere audio track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on audio track " + trackIndex + "."
    );
  }

  return { project, sequence, track, item };
}

async function listAudioEffects() {
  const displayNames = await premiere.AudioFilterFactory.getDisplayNames();
  const values = Array.isArray(displayNames) ? displayNames : [];

  return {
    count: values.length,
    truncated: values.length > 1500,
    effects: values.slice(0, 1500)
  };
}

async function inspectAudioClipEffects(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const { item } = await getAudioClipTarget(trackIndex, clipIndex);
  const chain = await item.getComponentChain();
  const componentCount = await chain.getComponentCount();
  const components = [];

  for (let componentIndex = 0; componentIndex < componentCount && componentIndex < 128; componentIndex += 1) {
    const component = await chain.getComponentAtIndex(componentIndex);
    const [matchName, displayName] = await Promise.all([
      component.getMatchName(),
      component.getDisplayName()
    ]);
    const paramCount = await component.getParamCount();
    const params = [];

    for (let paramIndex = 0; paramIndex < paramCount && paramIndex < 128; paramIndex += 1) {
      const param = await component.getParam(paramIndex);
      let startValue = null;
      let keyframesSupported = false;
      let timeVarying = false;
      let keyframeCount = 0;

      try {
        const start = await param.getStartValue();
        startValue = plainEffectValue(start?.value ?? start);
      } catch {
        startValue = null;
      }

      try {
        keyframesSupported = Boolean(await param.areKeyframesSupported());
      } catch {
        keyframesSupported = false;
      }

      try {
        timeVarying = Boolean(await param.isTimeVarying());
      } catch {
        timeVarying = false;
      }

      if (keyframesSupported) {
        try {
          const times = await param.getKeyframeListAsTickTimes();
          keyframeCount = Array.isArray(times) ? times.length : 0;
        } catch {
          keyframeCount = 0;
        }
      }

      params.push({
        paramIndex,
        displayName: param.displayName || null,
        startValue,
        keyframesSupported,
        timeVarying,
        keyframeCount
      });
    }

    components.push({
      componentIndex,
      matchName,
      displayName,
      paramCount,
      params,
      paramsTruncated: paramCount > 128
    });
  }

  return {
    track: trackIndex,
    clipIndex,
    componentCount,
    components,
    componentsTruncated: componentCount > 128
  };
}

async function addAudioEffect(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const displayName =
    typeof argumentsValue?.displayName === "string"
      ? argumentsValue.displayName.trim()
      : "";

  if (!displayName) throw new Error("Audio effect displayName is required.");

  const installed = await premiere.AudioFilterFactory.getDisplayNames();
  if (!Array.isArray(installed) || !installed.includes(displayName)) {
    throw new Error("Installed Premiere audio effect was not found: " + displayName);
  }

  const { project, item } = await getAudioClipTarget(trackIndex, clipIndex);
  const chain = await item.getComponentChain();
  const component = await premiere.AudioFilterFactory.createComponentByDisplayName(
    displayName,
    item
  );

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = chain.createAppendComponentAction(component);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Add Audio Effect");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the audio effect transaction.");
  }

  return {
    added: true,
    track: trackIndex,
    clipIndex,
    displayName
  };
}

async function resolveAudioEffectParam(trackIndex, clipIndex, componentIndex, paramIndex) {
  if (!Number.isInteger(componentIndex) || componentIndex < 0) {
    throw new Error("Component index must be a non-negative integer.");
  }
  if (!Number.isInteger(paramIndex) || paramIndex < 0) {
    throw new Error("Parameter index must be a non-negative integer.");
  }

  const target = await getAudioClipTarget(trackIndex, clipIndex);
  const chain = await target.item.getComponentChain();
  const componentCount = await chain.getComponentCount();
  if (componentIndex >= componentCount) {
    throw new Error("Requested audio effect component index was not found.");
  }

  const component = await chain.getComponentAtIndex(componentIndex);
  const paramCount = await component.getParamCount();
  if (paramIndex >= paramCount) {
    throw new Error("Requested audio effect parameter index was not found.");
  }

  const param = await component.getParam(paramIndex);
  return { ...target, component, param };
}

async function setAudioEffectParam(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const componentIndex = Number(argumentsValue?.componentIndex ?? 0);
  const paramIndex = Number(argumentsValue?.paramIndex ?? 0);
  const value = argumentsValue?.value;

  const { project, component, param } = await resolveAudioEffectParam(
    trackIndex,
    clipIndex,
    componentIndex,
    paramIndex
  );

  if (await param.isTimeVarying()) {
    throw new Error("This audio parameter is time-varying. Use the audio keyframe command instead.");
  }

  const keyframe = await param.createKeyframe(value);
  let transactionSucceeded = false;

  project.lockedAccess(() => {
    const action = param.createSetValueAction(keyframe, true);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Set Audio Effect Parameter");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the audio effect parameter transaction.");
  }

  return {
    changed: true,
    track: trackIndex,
    clipIndex,
    componentIndex,
    paramIndex,
    componentMatchName: await component.getMatchName(),
    paramDisplayName: param.displayName || null,
    value: plainEffectValue(value)
  };
}

async function addAudioEffectKeyframe(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const componentIndex = Number(argumentsValue?.componentIndex ?? 0);
  const paramIndex = Number(argumentsValue?.paramIndex ?? 0);
  const seconds = Number(argumentsValue?.seconds);
  const value = argumentsValue?.value;

  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("Audio keyframe seconds must be between 0 and 86400.");
  }

  const { project, component, param } = await resolveAudioEffectParam(
    trackIndex,
    clipIndex,
    componentIndex,
    paramIndex
  );

  if (!(await param.areKeyframesSupported())) {
    throw new Error("This Premiere audio parameter does not support keyframes.");
  }

  const keyframe = await param.createKeyframe(value);
  keyframe.position = premiere.TickTime.createWithSeconds(seconds);
  const alreadyTimeVarying = Boolean(await param.isTimeVarying());

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      if (!alreadyTimeVarying) {
        compoundAction.addAction(param.createSetTimeVaryingAction(true));
      }
      compoundAction.addAction(param.createAddKeyframeAction(keyframe));
    }, "Shuvi: Add Audio Effect Keyframe");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the audio effect keyframe transaction.");
  }

  return {
    added: true,
    track: trackIndex,
    clipIndex,
    componentIndex,
    paramIndex,
    componentMatchName: await component.getMatchName(),
    paramDisplayName: param.displayName || null,
    seconds,
    value: plainEffectValue(value)
  };
}

async function getSequenceMarkers() {
  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");
  const markers = await premiere.Markers.getMarkers(sequence);
  return { project, sequence, markers };
}

async function listMarkers() {
  const { markers } = await getSequenceMarkers();
  const values = await markers.getMarkers([]);
  const rows = [];

  for (const marker of values) {
    const [name, type, start, duration, comments, colorIndex] = await Promise.all([
      marker.getName(),
      marker.getType(),
      marker.getStart(),
      marker.getDuration(),
      marker.getComments(),
      marker.getColorIndex()
    ]);

    rows.push({
      marker,
      name: name || null,
      type: type || null,
      startSeconds: start?.seconds ?? 0,
      durationSeconds: duration?.seconds ?? 0,
      comments: comments || "",
      colorIndex
    });
  }

  rows.sort((a, b) => a.startSeconds - b.startSeconds);

  return {
    count: rows.length,
    markers: rows.slice(0, 1000).map((entry, markerIndex) => ({
      markerIndex,
      name: entry.name,
      type: entry.type,
      startSeconds: entry.startSeconds,
      durationSeconds: entry.durationSeconds,
      comments: entry.comments,
      colorIndex: entry.colorIndex
    })),
    truncated: rows.length > 1000
  };
}

async function addMarker(argumentsValue) {
  const name =
    typeof argumentsValue?.name === "string"
      ? argumentsValue.name.trim()
      : "";
  const markerType =
    typeof argumentsValue?.markerType === "string"
      ? argumentsValue.markerType
      : "Comment";
  const seconds = Number(argumentsValue?.seconds ?? 0);
  const durationSeconds = Number(argumentsValue?.durationSeconds ?? 0);
  const comments =
    typeof argumentsValue?.comments === "string"
      ? argumentsValue.comments
      : "";

  if (!name) throw new Error("Marker name is required.");
  if (!["Comment", "Chapter", "Segmentation", "WebLink"].includes(markerType)) {
    throw new Error("Unsupported marker type: " + markerType);
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("Marker seconds must be between 0 and 86400.");
  }
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0 || durationSeconds > 86400) {
    throw new Error("Marker duration must be between 0 and 86400 seconds.");
  }

  const { project, markers } = await getSequenceMarkers();
  const start = premiere.TickTime.createWithSeconds(seconds);
  const duration = premiere.TickTime.createWithSeconds(durationSeconds);

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = markers.createAddMarkerAction(
      name,
      markerType,
      start,
      duration,
      comments
    );
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Add Marker");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the marker transaction.");
  }

  return {
    added: true,
    name,
    markerType,
    seconds,
    durationSeconds,
    comments
  };
}

async function removeMarker(argumentsValue) {
  const markerIndex = Number(argumentsValue?.markerIndex);
  if (!Number.isInteger(markerIndex) || markerIndex < 0) {
    throw new Error("markerIndex must be a non-negative integer.");
  }

  const { project, markers } = await getSequenceMarkers();
  const values = await markers.getMarkers([]);
  const timed = [];

  for (const marker of values) {
    const start = await marker.getStart();
    timed.push({
      marker,
      startSeconds: start?.seconds ?? Number.POSITIVE_INFINITY
    });
  }

  timed.sort((a, b) => a.startSeconds - b.startSeconds);
  const target = timed[markerIndex]?.marker;
  if (!target) {
    throw new Error("Requested marker index was not found.");
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = markers.createRemoveMarkerAction(target);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Remove Marker");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the marker removal transaction.");
  }

  return {
    removed: true,
    markerIndex
  };
}

function asProjectItem(item) {
  try {
    return premiere.ProjectItem.cast(item);
  } catch {
    return null;
  }
}

function asFolderItem(item) {
  try {
    return premiere.FolderItem.cast(item);
  } catch {
    return null;
  }
}

function asClipProjectItem(item) {
  try {
    return premiere.ClipProjectItem.cast(item);
  } catch {
    return null;
  }
}

async function projectItemId(item) {
  const projectItem = asProjectItem(item);
  if (!projectItem) return null;
  try {
    return await projectItem.getId();
  } catch {
    return null;
  }
}

async function findProjectItemById(folder, wantedId, depth = 0) {
  if (depth > 16) return null;

  const folderId = await projectItemId(folder);
  if (folderId === wantedId) return folder;

  const items = await folder.getItems();
  for (const item of items) {
    const id = await projectItemId(item);
    if (id === wantedId) return item;

    const childFolder = asFolderItem(item);
    if (childFolder) {
      const nested = await findProjectItemById(childFolder, wantedId, depth + 1);
      if (nested) return nested;
    }
  }

  return null;
}

async function serializeProjectTreeItem(item, depth, budget) {
  if (budget.remaining <= 0) return null;
  budget.remaining -= 1;

  const id = await projectItemId(item);
  const folder = asFolderItem(item);
  const clip = asClipProjectItem(item);

  const result = {
    id,
    name: item?.name || null,
    type: item?.type ?? null,
    kind: folder ? "bin" : clip ? "clip" : "projectItem"
  };

  if (clip) {
    try {
      result.mediaPath = await clip.getMediaFilePath();
    } catch {
      result.mediaPath = null;
    }
    try {
      result.offline = Boolean(await clip.isOffline());
    } catch {
      result.offline = null;
    }
    try {
      result.hasProxy = Boolean(await clip.hasProxy());
    } catch {
      result.hasProxy = null;
    }
    try {
      result.proxyPath = await clip.getProxyPath();
    } catch {
      result.proxyPath = null;
    }
    try {
      result.canProxy = Boolean(await clip.canProxy());
    } catch {
      result.canProxy = null;
    }
    try {
      result.canChangeMediaPath = Boolean(await clip.canChangeMediaPath());
    } catch {
      result.canChangeMediaPath = null;
    }
    try {
      result.isSequence = Boolean(await clip.isSequence());
    } catch {
      result.isSequence = null;
    }
  }

  if (folder && depth < 8) {
    const children = await folder.getItems();
    result.childCount = children.length;
    result.children = [];

    for (const child of children) {
      if (budget.remaining <= 0) break;
      const serialized = await serializeProjectTreeItem(child, depth + 1, budget);
      if (serialized) result.children.push(serialized);
    }
    result.childrenTruncated = result.children.length < children.length;
  }

  return result;
}

async function projectTree() {
  const project = await requireProject();
  const root = await project.getRootItem();
  const budget = { remaining: 2000 };
  const tree = await serializeProjectTreeItem(root, 0, budget);

  return {
    projectName: project.name || null,
    maxDepth: 8,
    itemLimit: 2000,
    truncated: budget.remaining <= 0,
    tree
  };
}

async function renameProjectItem(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const name =
    typeof argumentsValue?.name === "string"
      ? argumentsValue.name.trim()
      : "";

  if (!itemId || !name) throw new Error("itemId and name are required.");

  const project = await requireProject();
  const root = await project.getRootItem();
  const item = await findProjectItemById(root, itemId);
  if (!item) throw new Error("Premiere project item id was not found.");

  const projectItem = asProjectItem(item);
  if (!projectItem) throw new Error("Requested item cannot be renamed through ProjectItem.");

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = projectItem.createSetNameAction(name);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Rename Project Item");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the project item rename transaction.");
  }

  return {
    renamed: true,
    itemId,
    name
  };
}

async function moveProjectItem(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const targetBinId =
    typeof argumentsValue?.targetBinId === "string"
      ? argumentsValue.targetBinId.trim()
      : "";

  if (!itemId || !targetBinId) {
    throw new Error("itemId and targetBinId are required.");
  }
  if (itemId === targetBinId) {
    throw new Error("A project item cannot be moved into itself.");
  }

  const project = await requireProject();
  const root = await project.getRootItem();
  const [item, targetCandidate] = await Promise.all([
    findProjectItemById(root, itemId),
    findProjectItemById(root, targetBinId)
  ]);

  if (!item) throw new Error("Premiere source project item id was not found.");
  if (!targetCandidate) throw new Error("Premiere destination bin id was not found.");

  const projectItem = asProjectItem(item);
  const targetBin = asFolderItem(targetCandidate);
  if (!projectItem) throw new Error("Requested source cannot be moved as a ProjectItem.");
  if (!targetBin) throw new Error("Requested destination is not a Premiere bin.");

  const sourceParent = await projectItem.getParentBin();
  if (!sourceParent) throw new Error("Premiere source item has no movable parent bin.");

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = sourceParent.createMoveItemAction(projectItem, targetBin);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Move Project Item");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the project item move transaction.");
  }

  return {
    moved: true,
    itemId,
    targetBinId
  };
}

async function relinkMedia(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const newPath =
    typeof argumentsValue?.newPath === "string"
      ? argumentsValue.newPath.trim()
      : "";
  const overrideCompatibility = Boolean(argumentsValue?.overrideCompatibility);

  if (!itemId || !newPath) {
    throw new Error("itemId and newPath are required.");
  }

  const project = await requireProject();
  const root = await project.getRootItem();
  const item = await findProjectItemById(root, itemId);
  if (!item) throw new Error("Premiere clip project item id was not found.");

  const clip = asClipProjectItem(item);
  if (!clip) throw new Error("Requested item is not a clip project item.");

  if (!(await clip.canChangeMediaPath())) {
    throw new Error("Premiere reports that this project item's media path cannot be changed.");
  }

  const previousPath = await clip.getMediaFilePath();
  const success = await clip.changeMediaFilePath(newPath, overrideCompatibility);
  if (!success) throw new Error("Premiere could not relink the requested media.");

  return {
    relinked: true,
    itemId,
    previousPath,
    newPath,
    overrideCompatibility
  };
}

async function attachProxy(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const proxyPath =
    typeof argumentsValue?.proxyPath === "string"
      ? argumentsValue.proxyPath.trim()
      : "";

  if (!itemId || !proxyPath) {
    throw new Error("itemId and proxyPath are required.");
  }

  const project = await requireProject();
  const root = await project.getRootItem();
  const item = await findProjectItemById(root, itemId);
  if (!item) throw new Error("Premiere clip project item id was not found.");

  const clip = asClipProjectItem(item);
  if (!clip) throw new Error("Requested item is not a clip project item.");

  if (!(await clip.canProxy())) {
    throw new Error("Premiere reports that this project item cannot use a proxy.");
  }

  const previousProxyPath = (await clip.hasProxy())
    ? await clip.getProxyPath()
    : null;

  const success = await clip.attachProxy(proxyPath, false, false);
  if (!success) throw new Error("Premiere could not attach the requested proxy.");

  return {
    attached: true,
    itemId,
    previousProxyPath,
    proxyPath
  };
}

function summarizeInsertedTrackItems(items) {
  const values = Array.isArray(items) ? items : [];
  return values.map((item, index) => ({
    index,
    name: item?.name || null,
    trackIndex: item?.trackIndex ?? null
  }));
}

async function insertMogrtFromPath(argumentsValue) {
  const path =
    typeof argumentsValue?.path === "string"
      ? argumentsValue.path.trim()
      : "";
  const seconds = Number(argumentsValue?.seconds ?? 0);
  const videoTrack = Number(argumentsValue?.videoTrack ?? 0);
  const audioTrack = Number(argumentsValue?.audioTrack ?? 0);

  if (!path) throw new Error("MOGRT path is required.");
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("MOGRT insert time must be between 0 and 86400 seconds.");
  }
  if (!Number.isInteger(videoTrack) || videoTrack < 0 ||
      !Number.isInteger(audioTrack) || audioTrack < 0) {
    throw new Error("MOGRT track indexes must be non-negative integers.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const editor = premiere.SequenceEditor.getEditor(sequence);
  const items = await editor.insertMogrtFromPath(
    path,
    premiere.TickTime.createWithSeconds(seconds),
    videoTrack,
    audioTrack
  );

  const inserted = summarizeInsertedTrackItems(items);
  if (!inserted.length) {
    throw new Error("Premiere did not insert the requested MOGRT.");
  }

  return {
    inserted: true,
    source: "path",
    path,
    seconds,
    videoTrack,
    audioTrack,
    items: inserted
  };
}

async function insertMogrtFromLibrary(argumentsValue) {
  const libraryName =
    typeof argumentsValue?.libraryName === "string"
      ? argumentsValue.libraryName.trim()
      : "";
  const elementName =
    typeof argumentsValue?.elementName === "string"
      ? argumentsValue.elementName.trim()
      : "";
  const seconds = Number(argumentsValue?.seconds ?? 0);
  const videoTrack = Number(argumentsValue?.videoTrack ?? 0);
  const audioTrack = Number(argumentsValue?.audioTrack ?? 0);

  if (!libraryName || !elementName) {
    throw new Error("MOGRT libraryName and elementName are required.");
  }
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("MOGRT insert time must be between 0 and 86400 seconds.");
  }
  if (!Number.isInteger(videoTrack) || videoTrack < 0 ||
      !Number.isInteger(audioTrack) || audioTrack < 0) {
    throw new Error("MOGRT track indexes must be non-negative integers.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const editor = premiere.SequenceEditor.getEditor(sequence);
  const items = await editor.insertMogrtFromLibrary(
    libraryName,
    elementName,
    premiere.TickTime.createWithSeconds(seconds),
    videoTrack,
    audioTrack
  );

  const inserted = summarizeInsertedTrackItems(items);
  if (!inserted.length) {
    throw new Error("Premiere did not insert the requested library MOGRT.");
  }

  return {
    inserted: true,
    source: "library",
    libraryName,
    elementName,
    seconds,
    videoTrack,
    audioTrack,
    items: inserted
  };
}

async function cloneClip(argumentsValue) {
  const kind =
    typeof argumentsValue?.kind === "string"
      ? argumentsValue.kind.toLowerCase()
      : "";
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const timeOffsetSeconds = Number(argumentsValue?.timeOffsetSeconds ?? 0);
  const videoTrackOffset = Number(argumentsValue?.videoTrackOffset ?? 0);
  const audioTrackOffset = Number(argumentsValue?.audioTrackOffset ?? 0);
  const alignToVideo = argumentsValue?.alignToVideo !== false;
  const insert = Boolean(argumentsValue?.insert);

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Clone kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Track index must be a non-negative integer.");
  }
  if (!Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Clip index must be a non-negative integer.");
  }
  if (!Number.isFinite(timeOffsetSeconds) || Math.abs(timeOffsetSeconds) > 36000) {
    throw new Error("Clone time offset must be finite and within ±10 hours.");
  }
  if (!Number.isInteger(videoTrackOffset) || Math.abs(videoTrackOffset) > 128 ||
      !Number.isInteger(audioTrackOffset) || Math.abs(audioTrackOffset) > 128) {
    throw new Error("Clone vertical track offsets must be integers within ±128.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere track was not found.");

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on " + kind + " track " + trackIndex + "."
    );
  }

  const start = await item.getStartTime();
  const destinationSeconds = (start?.seconds ?? 0) + timeOffsetSeconds;
  if (destinationSeconds < 0) {
    throw new Error("Clone would place the copied clip before sequence time zero.");
  }

  const editor = premiere.SequenceEditor.getEditor(sequence);
  let transactionSucceeded = false;

  project.lockedAccess(() => {
    const action = editor.createCloneTrackItemAction(
      item,
      premiere.TickTime.createWithSeconds(timeOffsetSeconds),
      videoTrackOffset,
      audioTrackOffset,
      alignToVideo,
      insert
    );

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Clone Clip");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the clip clone transaction.");
  }

  return {
    cloned: true,
    kind,
    track: trackIndex,
    clipIndex,
    sourceStartSeconds: start?.seconds ?? null,
    destinationSeconds,
    timeOffsetSeconds,
    videoTrackOffset,
    audioTrackOffset,
    alignToVideo,
    insert
  };
}

async function resolveNamedVideoParam(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const componentMatchName =
    typeof argumentsValue?.componentMatchName === "string" && argumentsValue.componentMatchName.trim()
      ? argumentsValue.componentMatchName.trim()
      : null;
  const componentDisplayName =
    typeof argumentsValue?.componentDisplayName === "string" && argumentsValue.componentDisplayName.trim()
      ? argumentsValue.componentDisplayName.trim()
      : null;
  const paramDisplayName =
    typeof argumentsValue?.paramDisplayName === "string"
      ? argumentsValue.paramDisplayName.trim()
      : "";

  if (!componentMatchName && !componentDisplayName) {
    throw new Error("A component match name or display name is required.");
  }
  if (!paramDisplayName) {
    throw new Error("A parameter display name is required.");
  }

  const target = await getVideoClipTarget(trackIndex, clipIndex);
  const chain = await target.item.getComponentChain();
  const componentCount = await chain.getComponentCount();
  const componentMatches = [];

  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    const component = await chain.getComponentAtIndex(componentIndex);
    const [matchName, displayName] = await Promise.all([
      component.getMatchName(),
      component.getDisplayName()
    ]);

    const matchOk = componentMatchName == null || matchName === componentMatchName;
    const displayOk = componentDisplayName == null || displayName === componentDisplayName;

    if (matchOk && displayOk) {
      componentMatches.push({ component, componentIndex, matchName, displayName });
    }
  }

  if (componentMatches.length === 0) {
    throw new Error("No Premiere video component matched the requested exact selector.");
  }
  if (componentMatches.length > 1) {
    throw new Error(
      "Video component selector matched " + componentMatches.length + " components. Refine the selector."
    );
  }

  const selected = componentMatches[0];
  const paramCount = await selected.component.getParamCount();
  const paramMatches = [];

  for (let paramIndex = 0; paramIndex < paramCount; paramIndex += 1) {
    const param = await selected.component.getParam(paramIndex);
    if ((param.displayName || "") === paramDisplayName) {
      paramMatches.push({ param, paramIndex });
    }
  }

  if (paramMatches.length === 0) {
    throw new Error("No Premiere video parameter matched display name: " + paramDisplayName);
  }
  if (paramMatches.length > 1) {
    throw new Error(
      "Video parameter name matched " + paramMatches.length + " parameters. Use index-based effect control."
    );
  }

  return {
    ...target,
    component: selected.component,
    componentIndex: selected.componentIndex,
    componentMatchName: selected.matchName,
    componentDisplayName: selected.displayName,
    param: paramMatches[0].param,
    paramIndex: paramMatches[0].paramIndex,
    paramDisplayName
  };
}

async function setVideoParamNamed(argumentsValue) {
  const value = argumentsValue?.value;
  const target = await resolveNamedVideoParam(argumentsValue);

  if (await target.param.isTimeVarying()) {
    throw new Error("This parameter is time-varying. Use the named keyframe command instead.");
  }

  const keyframe = await target.param.createKeyframe(value);
  let transactionSucceeded = false;

  target.project.lockedAccess(() => {
    const action = target.param.createSetValueAction(keyframe, true);
    transactionSucceeded = target.project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Set Named Video Parameter");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the named video parameter transaction.");
  }

  return {
    changed: true,
    track: Number(argumentsValue?.track ?? 0),
    clipIndex: Number(argumentsValue?.clipIndex ?? 0),
    componentIndex: target.componentIndex,
    componentMatchName: target.componentMatchName,
    componentDisplayName: target.componentDisplayName,
    paramIndex: target.paramIndex,
    paramDisplayName: target.paramDisplayName,
    value: plainEffectValue(value)
  };
}

async function addVideoKeyframeNamed(argumentsValue) {
  const seconds = Number(argumentsValue?.seconds);
  const value = argumentsValue?.value;

  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("Named video keyframe seconds must be between 0 and 86400.");
  }

  const target = await resolveNamedVideoParam(argumentsValue);

  if (!(await target.param.areKeyframesSupported())) {
    throw new Error("This named Premiere video parameter does not support keyframes.");
  }

  const keyframe = await target.param.createKeyframe(value);
  keyframe.position = premiere.TickTime.createWithSeconds(seconds);
  const alreadyTimeVarying = Boolean(await target.param.isTimeVarying());
  let transactionSucceeded = false;

  target.project.lockedAccess(() => {
    transactionSucceeded = target.project.executeTransaction((compoundAction) => {
      if (!alreadyTimeVarying) {
        compoundAction.addAction(target.param.createSetTimeVaryingAction(true));
      }
      compoundAction.addAction(target.param.createAddKeyframeAction(keyframe));
    }, "Shuvi: Add Named Video Keyframe");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the named video keyframe transaction.");
  }

  return {
    added: true,
    track: Number(argumentsValue?.track ?? 0),
    clipIndex: Number(argumentsValue?.clipIndex ?? 0),
    componentIndex: target.componentIndex,
    componentMatchName: target.componentMatchName,
    componentDisplayName: target.componentDisplayName,
    paramIndex: target.paramIndex,
    paramDisplayName: target.paramDisplayName,
    seconds,
    value: plainEffectValue(value)
  };
}

async function resolveNamedAudioParam(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const componentMatchName =
    typeof argumentsValue?.componentMatchName === "string" && argumentsValue.componentMatchName.trim()
      ? argumentsValue.componentMatchName.trim()
      : null;
  const componentDisplayName =
    typeof argumentsValue?.componentDisplayName === "string" && argumentsValue.componentDisplayName.trim()
      ? argumentsValue.componentDisplayName.trim()
      : null;
  const paramDisplayName =
    typeof argumentsValue?.paramDisplayName === "string"
      ? argumentsValue.paramDisplayName.trim()
      : "";

  if (!componentMatchName && !componentDisplayName) {
    throw new Error("An audio component match name or display name is required.");
  }
  if (!paramDisplayName) {
    throw new Error("An audio parameter display name is required.");
  }

  const target = await getAudioClipTarget(trackIndex, clipIndex);
  const chain = await target.item.getComponentChain();
  const componentCount = await chain.getComponentCount();
  const componentMatches = [];

  for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
    const component = await chain.getComponentAtIndex(componentIndex);
    const [matchName, displayName] = await Promise.all([
      component.getMatchName(),
      component.getDisplayName()
    ]);

    const matchOk = componentMatchName == null || matchName === componentMatchName;
    const displayOk = componentDisplayName == null || displayName === componentDisplayName;
    if (matchOk && displayOk) {
      componentMatches.push({ component, componentIndex, matchName, displayName });
    }
  }

  if (componentMatches.length === 0) {
    throw new Error("No Premiere audio component matched the requested exact selector.");
  }
  if (componentMatches.length > 1) {
    throw new Error(
      "Audio component selector matched " + componentMatches.length + " components. Refine the selector."
    );
  }

  const selected = componentMatches[0];
  const paramCount = await selected.component.getParamCount();
  const paramMatches = [];

  for (let paramIndex = 0; paramIndex < paramCount; paramIndex += 1) {
    const param = await selected.component.getParam(paramIndex);
    if ((param.displayName || "") === paramDisplayName) {
      paramMatches.push({ param, paramIndex });
    }
  }

  if (paramMatches.length === 0) {
    throw new Error("No Premiere audio parameter matched display name: " + paramDisplayName);
  }
  if (paramMatches.length > 1) {
    throw new Error(
      "Audio parameter name matched " + paramMatches.length + " parameters. Use index-based audio effect control."
    );
  }

  return {
    ...target,
    component: selected.component,
    componentIndex: selected.componentIndex,
    componentMatchName: selected.matchName,
    componentDisplayName: selected.displayName,
    param: paramMatches[0].param,
    paramIndex: paramMatches[0].paramIndex,
    paramDisplayName
  };
}

async function setAudioParamNamed(argumentsValue) {
  const value = argumentsValue?.value;
  const target = await resolveNamedAudioParam(argumentsValue);

  if (await target.param.isTimeVarying()) {
    throw new Error("This named audio parameter is time-varying. Use the named audio keyframe command instead.");
  }

  const keyframe = await target.param.createKeyframe(value);
  let transactionSucceeded = false;

  target.project.lockedAccess(() => {
    const action = target.param.createSetValueAction(keyframe, true);
    transactionSucceeded = target.project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Set Named Audio Parameter");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the named audio parameter transaction.");
  }

  return {
    changed: true,
    track: Number(argumentsValue?.track ?? 0),
    clipIndex: Number(argumentsValue?.clipIndex ?? 0),
    componentIndex: target.componentIndex,
    componentMatchName: target.componentMatchName,
    componentDisplayName: target.componentDisplayName,
    paramIndex: target.paramIndex,
    paramDisplayName: target.paramDisplayName,
    value: plainEffectValue(value)
  };
}

async function addAudioKeyframeNamed(argumentsValue) {
  const seconds = Number(argumentsValue?.seconds);
  const value = argumentsValue?.value;

  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("Named audio keyframe seconds must be between 0 and 86400.");
  }

  const target = await resolveNamedAudioParam(argumentsValue);
  if (!(await target.param.areKeyframesSupported())) {
    throw new Error("This named Premiere audio parameter does not support keyframes.");
  }

  const keyframe = await target.param.createKeyframe(value);
  keyframe.position = premiere.TickTime.createWithSeconds(seconds);
  const alreadyTimeVarying = Boolean(await target.param.isTimeVarying());
  let transactionSucceeded = false;

  target.project.lockedAccess(() => {
    transactionSucceeded = target.project.executeTransaction((compoundAction) => {
      if (!alreadyTimeVarying) {
        compoundAction.addAction(target.param.createSetTimeVaryingAction(true));
      }
      compoundAction.addAction(target.param.createAddKeyframeAction(keyframe));
    }, "Shuvi: Add Named Audio Keyframe");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the named audio keyframe transaction.");
  }

  return {
    added: true,
    track: Number(argumentsValue?.track ?? 0),
    clipIndex: Number(argumentsValue?.clipIndex ?? 0),
    componentIndex: target.componentIndex,
    componentMatchName: target.componentMatchName,
    componentDisplayName: target.componentDisplayName,
    paramIndex: target.paramIndex,
    paramDisplayName: target.paramDisplayName,
    seconds,
    value: plainEffectValue(value)
  };
}

async function applyVideoRecipe(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const settings = Array.isArray(argumentsValue?.settings)
    ? argumentsValue.settings
    : [];

  if (!settings.length || settings.length > 64) {
    throw new Error("Video recipe requires between 1 and 64 settings.");
  }

  const prepared = [];
  let project = null;
  const timeVaryingNeeded = new Set();

  for (let index = 0; index < settings.length; index += 1) {
    const setting = settings[index] || {};
    const target = await resolveNamedVideoParam({
      track: trackIndex,
      clipIndex,
      componentMatchName: setting.component_match_name ?? setting.componentMatchName ?? null,
      componentDisplayName: setting.component_display_name ?? setting.componentDisplayName ?? null,
      paramDisplayName: setting.param_display_name ?? setting.paramDisplayName ?? ""
    });

    project = project || target.project;

    const value = setting.value;
    const hasSeconds = setting.seconds != null;
    const seconds = hasSeconds ? Number(setting.seconds) : null;

    if (hasSeconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
        throw new Error("Video recipe setting #" + index + " has invalid keyframe seconds.");
      }
      if (!(await target.param.areKeyframesSupported())) {
        throw new Error(
          "Video recipe parameter does not support keyframes: " + target.paramDisplayName
        );
      }

      const keyframe = await target.param.createKeyframe(value);
      keyframe.position = premiere.TickTime.createWithSeconds(seconds);

      const uniqueParamKey = target.componentIndex + ":" + target.paramIndex;
      const isTimeVarying = Boolean(await target.param.isTimeVarying());

      if (!isTimeVarying && !timeVaryingNeeded.has(uniqueParamKey)) {
        prepared.push({
          action: target.param.createSetTimeVaryingAction(true),
          summary: null
        });
        timeVaryingNeeded.add(uniqueParamKey);
      }

      prepared.push({
        action: target.param.createAddKeyframeAction(keyframe),
        summary: {
          componentIndex: target.componentIndex,
          componentMatchName: target.componentMatchName,
          componentDisplayName: target.componentDisplayName,
          paramIndex: target.paramIndex,
          paramDisplayName: target.paramDisplayName,
          seconds,
          value: plainEffectValue(value)
        }
      });
    } else {
      if (await target.param.isTimeVarying()) {
        throw new Error(
          "Video recipe parameter is already time-varying; provide seconds for: " +
          target.paramDisplayName
        );
      }

      const keyframe = await target.param.createKeyframe(value);
      prepared.push({
        action: target.param.createSetValueAction(keyframe, true),
        summary: {
          componentIndex: target.componentIndex,
          componentMatchName: target.componentMatchName,
          componentDisplayName: target.componentDisplayName,
          paramIndex: target.paramIndex,
          paramDisplayName: target.paramDisplayName,
          seconds: null,
          value: plainEffectValue(value)
        }
      });
    }
  }

  if (!project) throw new Error("No active Premiere project for video recipe.");

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      for (const entry of prepared) {
        compoundAction.addAction(entry.action);
      }
    }, "Shuvi: Apply Video Recipe");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the video parameter recipe transaction.");
  }

  return {
    applied: true,
    track: trackIndex,
    clipIndex,
    settingCount: settings.length,
    settings: prepared
      .map((entry) => entry.summary)
      .filter((entry) => entry != null)
  };
}

async function applyAudioRecipe(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const clipIndex = Number(argumentsValue?.clipIndex ?? 0);
  const settings = Array.isArray(argumentsValue?.settings)
    ? argumentsValue.settings
    : [];

  if (!settings.length || settings.length > 64) {
    throw new Error("Audio recipe requires between 1 and 64 settings.");
  }

  const prepared = [];
  let project = null;
  const timeVaryingNeeded = new Set();

  for (let index = 0; index < settings.length; index += 1) {
    const setting = settings[index] || {};
    const target = await resolveNamedAudioParam({
      track: trackIndex,
      clipIndex,
      componentMatchName: setting.component_match_name ?? setting.componentMatchName ?? null,
      componentDisplayName: setting.component_display_name ?? setting.componentDisplayName ?? null,
      paramDisplayName: setting.param_display_name ?? setting.paramDisplayName ?? ""
    });

    project = project || target.project;

    const value = setting.value;
    const hasSeconds = setting.seconds != null;
    const seconds = hasSeconds ? Number(setting.seconds) : null;

    if (hasSeconds) {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
        throw new Error("Audio recipe setting #" + index + " has invalid keyframe seconds.");
      }
      if (!(await target.param.areKeyframesSupported())) {
        throw new Error(
          "Audio recipe parameter does not support keyframes: " + target.paramDisplayName
        );
      }

      const keyframe = await target.param.createKeyframe(value);
      keyframe.position = premiere.TickTime.createWithSeconds(seconds);

      const uniqueParamKey = target.componentIndex + ":" + target.paramIndex;
      const isTimeVarying = Boolean(await target.param.isTimeVarying());

      if (!isTimeVarying && !timeVaryingNeeded.has(uniqueParamKey)) {
        prepared.push({
          action: target.param.createSetTimeVaryingAction(true),
          summary: null
        });
        timeVaryingNeeded.add(uniqueParamKey);
      }

      prepared.push({
        action: target.param.createAddKeyframeAction(keyframe),
        summary: {
          componentIndex: target.componentIndex,
          componentMatchName: target.componentMatchName,
          componentDisplayName: target.componentDisplayName,
          paramIndex: target.paramIndex,
          paramDisplayName: target.paramDisplayName,
          seconds,
          value: plainEffectValue(value)
        }
      });
    } else {
      if (await target.param.isTimeVarying()) {
        throw new Error(
          "Audio recipe parameter is already time-varying; provide seconds for: " +
          target.paramDisplayName
        );
      }

      const keyframe = await target.param.createKeyframe(value);
      prepared.push({
        action: target.param.createSetValueAction(keyframe, true),
        summary: {
          componentIndex: target.componentIndex,
          componentMatchName: target.componentMatchName,
          componentDisplayName: target.componentDisplayName,
          paramIndex: target.paramIndex,
          paramDisplayName: target.paramDisplayName,
          seconds: null,
          value: plainEffectValue(value)
        }
      });
    }
  }

  if (!project) throw new Error("No active Premiere project for audio recipe.");

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      for (const entry of prepared) {
        compoundAction.addAction(entry.action);
      }
    }, "Shuvi: Apply Audio Recipe");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the audio parameter recipe transaction.");
  }

  return {
    applied: true,
    track: trackIndex,
    clipIndex,
    settingCount: settings.length,
    settings: prepared
      .map((entry) => entry.summary)
      .filter((entry) => entry != null)
  };
}

async function rollEdit(argumentsValue) {
  const kind =
    typeof argumentsValue?.kind === "string"
      ? argumentsValue.kind.toLowerCase()
      : "";
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const leftClipIndex = Number(argumentsValue?.leftClipIndex);
  const rightClipIndex = Number(argumentsValue?.rightClipIndex);
  const boundarySeconds = Number(argumentsValue?.boundarySeconds);

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Roll-edit kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Track index must be a non-negative integer.");
  }
  if (!Number.isInteger(leftClipIndex) || leftClipIndex < 0 ||
      !Number.isInteger(rightClipIndex) || rightClipIndex < 0) {
    throw new Error("Roll-edit clip indexes must be non-negative integers.");
  }
  if (rightClipIndex !== leftClipIndex + 1) {
    throw new Error("Roll edit requires adjacent timeline clip indexes.");
  }
  if (!Number.isFinite(boundarySeconds) || boundarySeconds < 0 || boundarySeconds > 86400) {
    throw new Error("Roll-edit boundary must be between 0 and 86400 seconds.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere track was not found.");

  const items = await sortedClipItems(track);
  const left = items[leftClipIndex];
  const right = items[rightClipIndex];

  if (!left || !right) {
    throw new Error("One or both roll-edit clips were not found.");
  }

  const [leftStart, leftEnd, rightStart, rightEnd] = await Promise.all([
    left.getStartTime(),
    left.getEndTime(),
    right.getStartTime(),
    right.getEndTime()
  ]);

  const leftStartSeconds = leftStart?.seconds ?? 0;
  const leftEndSeconds = leftEnd?.seconds ?? 0;
  const rightStartSeconds = rightStart?.seconds ?? 0;
  const rightEndSeconds = rightEnd?.seconds ?? 0;

  if (boundarySeconds <= leftStartSeconds || boundarySeconds >= rightEndSeconds) {
    throw new Error(
      "Roll-edit boundary must stay after the left clip start and before the right clip end."
    );
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const leftAction = left.createSetEndAction(
      premiere.TickTime.createWithSeconds(boundarySeconds)
    );
    const rightAction = right.createSetStartAction(
      premiere.TickTime.createWithSeconds(boundarySeconds)
    );

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(leftAction);
      compoundAction.addAction(rightAction);
    }, "Shuvi: Roll Edit");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the rolling edit transaction.");
  }

  return {
    rolled: true,
    kind,
    track: trackIndex,
    leftClipIndex,
    rightClipIndex,
    previousBoundary: {
      leftEndSeconds,
      rightStartSeconds
    },
    boundarySeconds
  };
}

async function requireClipProjectItemById(itemId) {
  const project = await requireProject();
  const root = await project.getRootItem();
  const item = await findProjectItemById(root, itemId);
  if (!item) throw new Error("Premiere clip project item id was not found.");

  const clip = asClipProjectItem(item);
  if (!clip) throw new Error("Requested project item is not a clip project item.");

  return { project, clip };
}

async function setSourceInOut(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const inSeconds = Number(argumentsValue?.inSeconds);
  const outSeconds = Number(argumentsValue?.outSeconds);

  if (!itemId) throw new Error("itemId is required.");
  if (!Number.isFinite(inSeconds) || !Number.isFinite(outSeconds) ||
      inSeconds < 0 || outSeconds <= inSeconds || outSeconds > 86400) {
    throw new Error("Source in/out values are invalid.");
  }

  const { project, clip } = await requireClipProjectItemById(itemId);
  let transactionSucceeded = false;

  project.lockedAccess(() => {
    const action = clip.createSetInOutPointsAction(
      premiere.TickTime.createWithSeconds(inSeconds),
      premiere.TickTime.createWithSeconds(outSeconds)
    );

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Set Source In/Out");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the source in/out transaction.");
  }

  return {
    changed: true,
    itemId,
    inSeconds,
    outSeconds
  };
}

async function clearSourceInOut(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";

  if (!itemId) throw new Error("itemId is required.");

  const { project, clip } = await requireClipProjectItemById(itemId);
  let transactionSucceeded = false;

  project.lockedAccess(() => {
    const action = clip.createClearInOutPointsAction();
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Clear Source In/Out");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the source in/out clear transaction.");
  }

  return {
    changed: true,
    itemId
  };
}

async function createSubclip(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const name =
    typeof argumentsValue?.name === "string"
      ? argumentsValue.name.trim()
      : "";
  const startSeconds = Number(argumentsValue?.startSeconds);
  const endSeconds = Number(argumentsValue?.endSeconds);
  const hardBoundaries = argumentsValue?.hardBoundaries !== false;
  const takeVideo = argumentsValue?.takeVideo !== false;
  const takeAudio = argumentsValue?.takeAudio !== false;

  if (!itemId || !name) throw new Error("itemId and subclip name are required.");
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
      startSeconds < 0 || endSeconds <= startSeconds || endSeconds > 86400) {
    throw new Error("Subclip start/end values are invalid.");
  }
  if (!takeVideo && !takeAudio) {
    throw new Error("Subclip must include video and/or audio.");
  }

  const { project, clip } = await requireClipProjectItemById(itemId);

  if (typeof clip.createSubClipAction !== "function") {
    throw new Error("This Premiere version does not expose createSubClipAction; Premiere 26.3+ is required.");
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = clip.createSubClipAction(
      name,
      premiere.TickTime.createWithSeconds(startSeconds),
      premiere.TickTime.createWithSeconds(endSeconds),
      hardBoundaries,
      {
        takeVideo,
        takeAudio
      }
    );

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Create Subclip");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the subclip transaction.");
  }

  return {
    created: true,
    itemId,
    name,
    startSeconds,
    endSeconds,
    hardBoundaries,
    takeVideo,
    takeAudio
  };
}

async function transcribeItem(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const language =
    typeof argumentsValue?.language === "string" && argumentsValue.language.trim()
      ? argumentsValue.language.trim()
      : null;

  if (!itemId) throw new Error("itemId is required.");
  if (!premiere.Transcript || typeof premiere.Transcript.transcribeClipProjectItem !== "function") {
    throw new Error("This Premiere version does not expose Transcript.transcribeClipProjectItem.");
  }

  const { clip } = await requireClipProjectItemById(itemId);

  const success = language
    ? await premiere.Transcript.transcribeClipProjectItem(clip, { language })
    : await premiere.Transcript.transcribeClipProjectItem(clip);

  if (!success) {
    throw new Error("Premiere did not complete transcription for the requested clip.");
  }

  return {
    transcribed: true,
    itemId,
    language
  };
}

async function exportTranscript(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";

  if (!itemId) throw new Error("itemId is required.");
  if (!premiere.Transcript || typeof premiere.Transcript.exportToJSON !== "function") {
    throw new Error("This Premiere version does not expose Transcript.exportToJSON.");
  }

  const { clip } = await requireClipProjectItemById(itemId);
  const transcriptJson = await premiere.Transcript.exportToJSON(clip);

  if (typeof transcriptJson !== "string" || !transcriptJson.trim()) {
    throw new Error("No Premiere transcript is available for the requested clip.");
  }

  const previewLimit = 80000;
  return {
    itemId,
    chars: transcriptJson.length,
    truncated: transcriptJson.length > previewLimit,
    transcriptJson: transcriptJson.slice(0, previewLimit)
  };
}

async function listTranscriptionLanguages() {
  if (!premiere.Transcript || typeof premiere.Transcript.querySupportedLanguages !== "function") {
    throw new Error("This Premiere version does not expose querySupportedLanguages; Premiere 26.3+ is required.");
  }

  const languages = premiere.Transcript.querySupportedLanguages();
  const values = Array.isArray(languages) ? languages : [];

  return {
    count: values.length,
    languages: values.map((language) => ({
      displayString: language?.displayString || null,
      languageCode: language?.languageCode || null,
      locale: language?.locale || null,
      packAvailable:
        language?.languageCode &&
        typeof premiere.Transcript.isLanguagePackAvailable === "function"
          ? Boolean(premiere.Transcript.isLanguagePackAvailable(language.languageCode))
          : null
    }))
  };
}

async function importTranscript(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const transcriptJson =
    typeof argumentsValue?.transcriptJson === "string"
      ? argumentsValue.transcriptJson
      : "";

  if (!itemId || !transcriptJson.trim()) {
    throw new Error("itemId and transcriptJson are required.");
  }

  const { project, clip } = await requireClipProjectItemById(itemId);
  if (!premiere.Transcript ||
      typeof premiere.Transcript.importFromJSON !== "function" ||
      typeof premiere.Transcript.createImportTextSegmentsAction !== "function") {
    throw new Error("This Premiere version does not expose transcript import APIs.");
  }

  const textSegments = premiere.Transcript.importFromJSON(transcriptJson);
  let transactionSucceeded = false;

  project.lockedAccess(() => {
    const action = premiere.Transcript.createImportTextSegmentsAction(
      textSegments,
      clip
    );
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Import Transcript");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the transcript import transaction.");
  }

  return {
    imported: true,
    itemId,
    chars: transcriptJson.length
  };
}

async function resolveSubsequenceTarget(sequence, target) {
  const kind =
    typeof target?.kind === "string"
      ? target.kind.toLowerCase()
      : "";
  const trackIndex = Number(target?.track ?? 0);
  const clipIndex = Number(target?.clipIndex ?? 0);

  if (kind !== "video" && kind !== "audio") {
    throw new Error("Subsequence target kind must be video or audio.");
  }
  if (!Number.isInteger(trackIndex) || trackIndex < 0 ||
      !Number.isInteger(clipIndex) || clipIndex < 0) {
    throw new Error("Subsequence track and clip indexes must be non-negative integers.");
  }

  const track =
    kind === "video"
      ? await sequence.getVideoTrack(trackIndex)
      : await sequence.getAudioTrack(trackIndex);
  if (!track) {
    throw new Error("Requested subsequence track was not found.");
  }

  const items = await sortedClipItems(track);
  const item = items[clipIndex];
  if (!item) {
    throw new Error(
      "Clip index " + clipIndex + " was not found on " + kind + " track " + trackIndex + "."
    );
  }

  return { item, kind, trackIndex, clipIndex };
}

async function replaceSequenceSelection(sequence, items) {
  const selection = await sequence.getSelection();
  const existing = await selection.getTrackItems();

  for (const item of existing) {
    selection.removeItem(item);
  }
  for (const item of items) {
    selection.addItem(item, false);
  }

  const result = sequence.setSelection(selection);
  if (result && typeof result.then === "function") {
    return await result;
  }
  return result;
}

async function createSubsequence(argumentsValue) {
  const targets = Array.isArray(argumentsValue?.targets)
    ? argumentsValue.targets
    : [];

  if (!targets.length || targets.length > 64) {
    throw new Error("Subsequence creation requires between 1 and 64 targets.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const previousSelection = await sequence.getSelection();
  const previousItems = await previousSelection.getTrackItems();
  const resolved = [];

  for (const target of targets) {
    resolved.push(await resolveSubsequenceTarget(sequence, target));
  }

  const uniqueItems = [];
  const seen = new Set();
  for (const entry of resolved) {
    const key = entry.kind + ":" + entry.trackIndex + ":" + entry.clipIndex;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueItems.push(entry.item);
  }

  if (!uniqueItems.length) {
    throw new Error("No unique Premiere clips were resolved for the subsequence.");
  }

  const selectionSet = await replaceSequenceSelection(sequence, uniqueItems);
  if (selectionSet === false) {
    throw new Error("Premiere could not set the exact subsequence selection.");
  }

  let newSequence;
  try {
    newSequence = await sequence.createSubsequence(true);
  } finally {
    try {
      await replaceSequenceSelection(sequence, previousItems);
    } catch {
      // Best-effort restore of the user's prior selection.
    }
  }

  if (!newSequence) {
    throw new Error("Premiere did not return a new subsequence.");
  }

  let projectItemId = null;
  try {
    const projectItem = await newSequence.getProjectItem();
    projectItemId = await projectItem.getId();
  } catch {
    projectItemId = null;
  }

  return {
    created: true,
    selectedClipCount: uniqueItems.length,
    sequenceGuid: plainGuid(newSequence.guid),
    sequenceName: newSequence.name || null,
    projectItemId
  };
}

async function captionTracks() {
  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const count = await sequence.getCaptionTrackCount();
  const tracks = [];

  for (let index = 0; index < count; index += 1) {
    const track = await sequence.getCaptionTrack(index);
    if (!track) continue;

    let resolvedIndex = index;
    let muted = null;

    try {
      resolvedIndex = await track.getIndex();
    } catch {
      resolvedIndex = index;
    }

    try {
      muted = Boolean(await track.isMuted());
    } catch {
      muted = null;
    }

    tracks.push({
      index: resolvedIndex,
      id: track.id ?? null,
      name: track.name || null,
      muted
    });
  }

  return {
    count,
    tracks
  };
}

async function setCaptionTrackName(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const name =
    typeof argumentsValue?.name === "string"
      ? argumentsValue.name.trim()
      : "";

  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Caption track index must be a non-negative integer.");
  }
  if (!name) throw new Error("Caption track name is required.");

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track = await sequence.getCaptionTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere caption track was not found.");
  if (typeof track.createSetNameAction !== "function") {
    throw new Error("This Premiere version does not expose caption track rename actions; Premiere 26.3+ is required.");
  }

  let transactionSucceeded = false;
  project.lockedAccess(() => {
    const action = track.createSetNameAction(name);
    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, "Shuvi: Rename Caption Track");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the caption track rename transaction.");
  }

  return {
    renamed: true,
    track: trackIndex,
    name
  };
}

async function setCaptionTrackMute(argumentsValue) {
  const trackIndex = Number(argumentsValue?.track ?? 0);
  const muted = argumentsValue?.muted;

  if (!Number.isInteger(trackIndex) || trackIndex < 0) {
    throw new Error("Caption track index must be a non-negative integer.");
  }
  if (typeof muted !== "boolean") {
    throw new Error("muted must be a boolean.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const track = await sequence.getCaptionTrack(trackIndex);
  if (!track) throw new Error("Requested Premiere caption track was not found.");

  const success = await track.setMute(muted);
  if (!success) {
    throw new Error("Premiere could not change the caption track mute state.");
  }

  return {
    changed: true,
    track: trackIndex,
    muted
  };
}

async function insertProjectItem(argumentsValue) {
  const itemId =
    typeof argumentsValue?.itemId === "string"
      ? argumentsValue.itemId.trim()
      : "";
  const seconds = Number(argumentsValue?.seconds ?? 0);
  const videoTrack = Number(argumentsValue?.videoTrack ?? 0);
  const audioTrack = Number(argumentsValue?.audioTrack ?? 0);
  const mode =
    typeof argumentsValue?.mode === "string"
      ? argumentsValue.mode.toLowerCase()
      : "insert";

  if (!itemId) throw new Error("Project item id is required.");
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error("Timeline seconds must be between 0 and 86400.");
  }
  if (!Number.isInteger(videoTrack) || videoTrack < 0 ||
      !Number.isInteger(audioTrack) || audioTrack < 0) {
    throw new Error("Timeline track indexes must be non-negative integers.");
  }
  if (mode !== "insert" && mode !== "overwrite") {
    throw new Error("Mode must be insert or overwrite.");
  }

  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");

  const root = await project.getRootItem();
  const item = await findProjectItemById(root, itemId);
  if (!item) throw new Error("Premiere project item id was not found.");

  const projectItem = asProjectItem(item);
  if (!projectItem) throw new Error("Requested item cannot be inserted as a ProjectItem.");

  const editor = premiere.SequenceEditor.getEditor(sequence);
  const time = premiere.TickTime.createWithSeconds(seconds);
  let transactionSucceeded = false;

  project.lockedAccess(() => {
    const action =
      mode === "insert"
        ? editor.createInsertProjectItemAction(
            projectItem,
            time,
            videoTrack,
            audioTrack,
            true
          )
        : editor.createOverwriteItemAction(
            projectItem,
            time,
            videoTrack,
            audioTrack
          );

    transactionSucceeded = project.executeTransaction((compoundAction) => {
      compoundAction.addAction(action);
    }, mode === "insert" ? "Shuvi: Insert Project Item" : "Shuvi: Overwrite Project Item");
  });

  if (!transactionSucceeded) {
    throw new Error("Premiere rejected the project-item timeline transaction.");
  }

  let isSequence = null;
  const clip = asClipProjectItem(item);
  if (clip) {
    try {
      isSequence = Boolean(await clip.isSequence());
    } catch {
      isSequence = null;
    }
  }

  return {
    edited: true,
    itemId,
    itemName: item?.name || null,
    isSequence,
    mode,
    seconds,
    videoTrack,
    audioTrack
  };
}

async function resolveKeyframeTarget(argumentsValue) {
  if (argumentsValue.kind !== "video" && argumentsValue.kind !== "audio") throw new Error("Keyframe kind must be video or audio.");
  const target = argumentsValue.kind === "video"
    ? await resolveNamedVideoParam(argumentsValue) : await resolveNamedAudioParam(argumentsValue);
  if (typeof target.param.getKeyframeListAsTickTimes !== "function" || !(await target.param.areKeyframesSupported())) {
    throw new Error("This Premiere parameter does not expose native keyframe inspection.");
  }
  const [name, start, end, sourceIn, sourceOut, projectItem] = await Promise.all([
    target.item.getName(), target.item.getStartTime(), target.item.getEndTime(),
    target.item.getInPoint(), target.item.getOutPoint(), target.item.getProjectItem()
  ]);
  const projectItemIdValue = await projectItemId(projectItem);
  const ticks = [start, end, sourceIn, sourceOut].map(time => time?.ticks);
  const projectGuid = plainGuid(target.project.guid);
  const sequenceGuid = plainGuid(target.sequence.guid);
  if (!projectGuid || !sequenceGuid || !projectItemIdValue || ticks.some(value => typeof value !== "string")) {
    throw new Error("Native identity/timing is unavailable; cannot safely identify the keyframe target.");
  }
  const signature = JSON.stringify([
    projectGuid, sequenceGuid, argumentsValue.kind,
    argumentsValue.track, argumentsValue.clipIndex, projectItemIdValue, name, ...ticks,
    target.componentIndex, target.componentMatchName, target.componentDisplayName,
    target.paramIndex, target.paramDisplayName
  ]);
  const times = await target.param.getKeyframeListAsTickTimes();
  if (!Array.isArray(times) || times.length > 10000) throw new Error("Keyframe list exceeds the 10,000-key inspection safety limit.");
  return { ...target, signature, times };
}

async function inspectKeyframes(argumentsValue) {
  const target = await resolveKeyframeTarget(argumentsValue);
  const keyframes = [];
  for (const time of target.times.slice(0, 256)) {
    const entry = { ...plainTickTime(time), value: null, valueAvailable: false, interpolation: null };
    try {
      const value = plainEffectValue(await target.param.getValueAtTime(time));
      if (utf8ByteLength(JSON.stringify(value)) <= 256) {
        entry.value = value;
        entry.valueAvailable = true;
      }
    } catch { /* Some native parameter types cannot be read or serialized. */ }
    try {
      const keyframe = await target.param.getKeyframePtr(time);
      const mode = await keyframe.getTemporalInterpolationMode();
      entry.interpolation = ["LINEAR", "HOLD", "BEZIER"].find(name => premiere.Constants.InterpolationMode?.[name] === mode)?.toLowerCase() ?? null;
    } catch { /* Report unavailable instead of guessing an interpolation mode. */ }
    keyframes.push(entry);
  }
  return {
    targetSignature: target.signature,
    componentMatchName: target.componentMatchName, paramDisplayName: target.paramDisplayName,
    timeDomain: "native_parameter_ticks", total: target.times.length,
    truncated: target.times.length > 256,
    keyframes,
    supportedEdits: {
      remove: typeof target.param.createRemoveKeyframeAction === "function",
      interpolation: typeof target.param.createSetInterpolationAtKeyframeAction === "function"
    }
  };
}

async function removeKeyframeRange(argumentsValue) {
  const { startSeconds, endSeconds, expectedCount, allowRemoveAll = false } = argumentsValue;
  if (typeof startSeconds !== "number" || typeof endSeconds !== "number" ||
      !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds > 86400) {
    throw new Error("Keyframe range requires 0 <= start < end <= 86400 in native parameter seconds.");
  }
  if (!Number.isInteger(expectedCount) || expectedCount < 1 || expectedCount > 256 || typeof allowRemoveAll !== "boolean") throw new Error("Range requires an expected count from 1 to 256 and a boolean all-keys policy.");
  const target = await resolveKeyframeTarget(argumentsValue);
  if (argumentsValue.expectedSignature !== target.signature) throw new Error("Premiere keyframe target changed; inspect again.");
  if (target.times.some(time => !Number.isFinite(time.seconds) || typeof time.ticks !== "string")) throw new Error("Native keyframe timing is unavailable.");
  const selected = target.times.filter(time => time.seconds >= startSeconds && time.seconds < endSeconds);
  if (selected.length !== expectedCount) throw new Error("Keyframe count changed or does not match the inspected range; no keys removed.");
  if (selected.length === target.times.length && !allowRemoveAll) throw new Error("Range would remove every keyframe; explicitly approve allow_remove_all or narrow the range.");
  if (typeof target.param.createRemoveKeyframeAction !== "function") throw new Error("Native keyframe removal is unsupported.");
  let succeeded = false;
  target.project.lockedAccess(() => {
    // Enumerate exact keys to give deterministic [start,end) semantics rather
    // than assuming undocumented endpoint inclusion of the native range API.
    const actions = selected.map(time => target.param.createRemoveKeyframeAction(time, true));
    succeeded = target.project.executeTransaction(compound => {
      for (const action of actions) compound.addAction(action);
    }, "Shuvi: Remove Inspected Keyframe Range");
  });
  if (!succeeded) throw new Error("Premiere rejected the keyframe range transaction.");
  return { removed: true, count: selected.length, ticks: selected.map(time => time.ticks), startSeconds, endSeconds, endExclusive: true };
}

async function removeVideoTransition(argumentsValue) {
  const { track, clipIndex, position } = argumentsValue;
  if (position !== "start" && position !== "end") throw new Error("Transition position must be start or end.");
  const target = await getVideoClipTarget(track, clipIndex);
  const nativePosition = premiere.Constants.TransitionPosition?.[position === "start" ? "START" : "END"];
  if (typeof nativePosition !== "number" || typeof target.item.createRemoveVideoTransitionAction !== "function") throw new Error("Native transition removal is unsupported by this Premiere installation.");
  let succeeded = false;
  target.project.lockedAccess(() => {
    const action = target.item.createRemoveVideoTransitionAction(nativePosition);
    succeeded = target.project.executeTransaction(compound => compound.addAction(action), "Shuvi: Remove Video Transition");
  });
  if (!succeeded) throw new Error("Premiere rejected the transition removal transaction.");
  return { transactionSucceeded: true, track, clipIndex, position, warning: "Native transaction accepted; transition presence/details were not independently inspected." };
}

async function editKeyframe(argumentsValue) {
  if (!["remove", "interpolation"].includes(argumentsValue.operation)) throw new Error("Keyframe operation must be remove or interpolation.");
  if (typeof argumentsValue.ticks !== "string" || !/^-?\d{1,30}$/.test(argumentsValue.ticks)) throw new Error("Use exact ticks returned by keyframe inspection.");
  const target = await resolveKeyframeTarget(argumentsValue);
  if (argumentsValue.expectedSignature !== target.signature) throw new Error("Premiere keyframe target changed; inspect again before editing.");
  const matches = target.times.filter(time => time.ticks === argumentsValue.ticks);
  if (matches.length !== 1) throw new Error("Requested native keyframe is missing or ambiguous; inspect again.");
  const time = matches[0];
  const operation = argumentsValue.operation;
  let mode = null;
  if (operation === "interpolation") {
    const name = { linear: "LINEAR", hold: "HOLD", bezier: "BEZIER" }[argumentsValue.interpolation];
    mode = name ? premiere.Constants.InterpolationMode?.[name] : undefined;
    if (typeof mode !== "number" || typeof target.param.createSetInterpolationAtKeyframeAction !== "function") {
      throw new Error("Requested interpolation is unsupported by this Premiere installation.");
    }
  } else if (typeof target.param.createRemoveKeyframeAction !== "function") throw new Error("Native keyframe removal is unsupported.");
  let succeeded = false;
  target.project.lockedAccess(() => {
    const action = operation === "remove"
      ? target.param.createRemoveKeyframeAction(time, true)
      : target.param.createSetInterpolationAtKeyframeAction(time, mode, true);
    succeeded = target.project.executeTransaction(compound => compound.addAction(action), "Shuvi: Edit Named Keyframe");
  });
  if (!succeeded) throw new Error("Premiere rejected the keyframe edit transaction.");
  return { edited: true, operation, ticks: argumentsValue.ticks, interpolation: operation === "interpolation" ? argumentsValue.interpolation : null, targetSignature: target.signature };
}

async function inspectClipSpeed(argumentsValue) {
  const project = await requireProject();
  const sequence = await project.getActiveSequence();
  if (!sequence) throw new Error("No active Premiere sequence.");
  const { item, kind, trackIndex, clipIndex } = await resolveSubsequenceTarget(sequence, argumentsValue);
  const [name, start, end, sourceIn, sourceOut, nativeSpeed, reversed] = await Promise.all([
    item.getName(), item.getStartTime(), item.getEndTime(), item.getInPoint(), item.getOutPoint(),
    typeof item.getSpeed === "function" ? item.getSpeed() : null,
    typeof item.isSpeedReversed === "function" ? item.isSpeedReversed() : null
  ]);
  return {
    projectGuid: plainGuid(project.guid), sequenceGuid: plainGuid(sequence.guid),
    kind, track: trackIndex, clipIndex, name,
    startSeconds: start?.seconds ?? null, endSeconds: end?.seconds ?? null,
    sourceInSeconds: sourceIn?.seconds ?? null, sourceOutSeconds: sourceOut?.seconds ?? null,
    nativeSpeed, reversed: reversed === null ? null : Boolean(reversed),
    speedWrite: SPEED_CAPABILITY
  };
}

async function planClipSpeed(argumentsValue) {
  const snapshot = await inspectClipSpeed(argumentsValue);
  return planSpeed(snapshot, argumentsValue.request);
}

async function dispatchNativeCommand(command) {
  switch (command.action) {
    case "remove_keyframe_range":
      return await removeKeyframeRange(command.arguments || {});
    case "remove_video_transition":
      return await removeVideoTransition(command.arguments || {});
    case "inspect_keyframes":
      return await inspectKeyframes(command.arguments || {});
    case "edit_keyframe":
      return await editKeyframe(command.arguments || {});
    case "inspect_clip_speed":
      return await inspectClipSpeed(command.arguments || {});
    case "plan_clip_speed":
      return await planClipSpeed(command.arguments || {});
    case "inspect_context":
      return await inspectActiveContext();
    case "list_root_items":
      return await listRootItems();
    case "project_tree":
      return await projectTree();
    case "create_bin":
      return await createBin(command.arguments || {});
    case "rename_project_item":
      return await renameProjectItem(command.arguments || {});
    case "move_project_item":
      return await moveProjectItem(command.arguments || {});
    case "relink_media":
      return await relinkMedia(command.arguments || {});
    case "set_source_inout":
      return await setSourceInOut(command.arguments || {});
    case "clear_source_inout":
      return await clearSourceInOut(command.arguments || {});
    case "create_subclip":
      return await createSubclip(command.arguments || {});
    case "list_transcription_languages":
      return await listTranscriptionLanguages();
    case "transcribe_item":
      return await transcribeItem(command.arguments || {});
    case "export_transcript":
      return await exportTranscript(command.arguments || {});
    case "import_transcript":
      return await importTranscript(command.arguments || {});
    case "attach_proxy":
      return await attachProxy(command.arguments || {});
    case "insert_mogrt_path":
      return await insertMogrtFromPath(command.arguments || {});
    case "insert_mogrt_library":
      return await insertMogrtFromLibrary(command.arguments || {});
    case "import_media":
      return await importMedia(command.arguments || {});
    case "create_sequence_from_media":
      return await createSequenceFromMedia(command.arguments || {});
    case "create_subsequence":
      return await createSubsequence(command.arguments || {});
    case "insert_project_item":
      return await insertProjectItem(command.arguments || {});
    case "save_project":
      return await saveProject();
    case "inspect_timeline":
      return await inspectTimeline();
    case "caption_tracks":
      return await captionTracks();
    case "set_caption_track_name":
      return await setCaptionTrackName(command.arguments || {});
    case "set_caption_track_mute":
      return await setCaptionTrackMute(command.arguments || {});
    case "set_playhead":
      return await setPlayhead(command.arguments || {});
    case "set_track_mute":
      return await setTrackMute(command.arguments || {});
    case "set_clip_enabled":
      return await setClipEnabled(command.arguments || {});
    case "list_video_transitions":
      return await listVideoTransitions();
    case "add_video_transition":
      return await addVideoTransition(command.arguments || {});
    case "list_video_effects":
      return await listVideoEffects();
    case "inspect_clip_effects":
      return await inspectClipEffects(command.arguments || {});
    case "add_video_effect":
      return await addVideoEffect(command.arguments || {});
    case "set_effect_param":
      return await setEffectParam(command.arguments || {});
    case "set_video_param_named":
      return await setVideoParamNamed(command.arguments || {});
    case "add_effect_keyframe":
      return await addEffectKeyframe(command.arguments || {});
    case "add_video_keyframe_named":
      return await addVideoKeyframeNamed(command.arguments || {});
    case "apply_video_recipe":
      return await applyVideoRecipe(command.arguments || {});
    case "list_audio_effects":
      return await listAudioEffects();
    case "inspect_audio_clip_effects":
      return await inspectAudioClipEffects(command.arguments || {});
    case "add_audio_effect":
      return await addAudioEffect(command.arguments || {});
    case "set_audio_effect_param":
      return await setAudioEffectParam(command.arguments || {});
    case "set_audio_param_named":
      return await setAudioParamNamed(command.arguments || {});
    case "add_audio_effect_keyframe":
      return await addAudioEffectKeyframe(command.arguments || {});
    case "add_audio_keyframe_named":
      return await addAudioKeyframeNamed(command.arguments || {});
    case "apply_audio_recipe":
      return await applyAudioRecipe(command.arguments || {});
    case "list_markers":
      return await listMarkers();
    case "add_marker":
      return await addMarker(command.arguments || {});
    case "remove_marker":
      return await removeMarker(command.arguments || {});
    case "insert_media":
      return await insertMedia(command.arguments || {});
    case "trim_clip":
      return await trimClip(command.arguments || {});
    case "roll_edit":
      return await rollEdit(command.arguments || {});
    case "move_clip":
      return await moveClip(command.arguments || {});
    case "clone_clip":
      return await cloneClip(command.arguments || {});
    case "delete_clip":
      return await deleteClip(command.arguments || {});
    case "export_sequence":
      return await exportSequence(command.arguments || {});
    default:
      throw new Error("Unsupported Shuvi Premiere command: " + command.action);
  }
}

function utf8ByteLength(text) {
  let bytes = 0;
  for (const char of text) {
    const point = char.codePointAt(0);
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

async function postResult(command, success, data, error, sessionToken) {
  let body;
  try {
    body = JSON.stringify({ id: command.id, success, data: success ? data : null, error: success ? null : String(error || "Unknown Premiere bridge error") });
    if (utf8ByteLength(body) > 240 * 1024) throw new Error("Result exceeds 240 KiB");
  } catch {
    body = JSON.stringify({ id: command.id, success: false, data: null, error: "Result could not be serialized within 240 KiB. The operation may have completed; inspect Premiere before retrying." });
  }
  await bridgeFetch(
    "/result",
    {
      method: "POST",
      body
    },
    4000,
    sessionToken
  );
}

async function pollBridge() {
  if (!bridgeToken || busy) return;

  busy = true;
  const sessionToken = bridgeToken;
  try {
    const command = await bridgeFetch("/command", {}, 2500, sessionToken);
    if (bridgeToken !== sessionToken) return;

    setStatus("Connected to Shuvi", true);

    if (command && command.id && command.action) {
      show("Running: " + command.action);

      let data = null;
      let commandError = null;
      try {
        data = await executeCommand(command);
      } catch (error) {
        commandError = String(error);
      }
      // A delivery failure is not an execution failure. Never re-run the edit
      // or post a contradictory second result with a newly paired token.
      try {
        await postResult(command, commandError === null, data, commandError, sessionToken);
        show(commandError === null ? JSON.stringify(data, null, 2) : "Command failed: " + commandError);
      } catch (error) {
        show("Result delivery unconfirmed; the command may have completed. Inspect Premiere before retrying. " + String(error));
        setStatus("Result delivery unconfirmed", false);
      }
    }
  } catch (error) {
    setStatus("Not paired: " + String(error), false);
  } finally {
    busy = false;
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => void pollBridge(), 650);
  void pollBridge();
}

function connectBridge() {
  const token = el("tokenInput")?.value?.trim() || "";
  if (!token) {
    setStatus("Paste the pairing token from Shuvi.", false);
    return;
  }

  bridgeToken = token;
  startPolling();
  setStatus("Connecting…", false);
}

function disconnectBridge() {
  bridgeToken = "";
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  setStatus("Disconnected", false);
}

entrypoints.setup({
  panels: {
    "shuvi-premiere-panel": {
      create() {
        const inspect = el("inspect");
        if (inspect) {
          inspect.addEventListener("click", async () => {
            try {
              show(JSON.stringify(await inspectActiveContext(), null, 2));
            } catch (error) {
              show("Premiere inspection failed: " + String(error));
            }
          });
        }

        el("connect")?.addEventListener("click", connectBridge);
        el("disconnect")?.addEventListener("click", disconnectBridge);
      },
      show() {
        if (bridgeToken) startPolling();
      },
      hide() {
        // Keep polling while Premiere is running so Shuvi can finish an approved task.
      },
      destroy() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  }
});
