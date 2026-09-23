const { entrypoints, host, versions } = require("uxp");
const premiere = require("premierepro");

const BRIDGE_BASE = "http://127.0.0.1:17361";
let bridgeToken = "";
let pollTimer = null;
let busy = false;

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

async function bridgeFetch(path, options = {}, timeoutMs = 2500) {
  if (!bridgeToken) throw new Error("Enter the Shuvi pairing token first.");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(BRIDGE_BASE + path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "X-Shuvi-Token": bridgeToken,
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
  return project;
}

async function inspectActiveContext() {
  const project = await premiere.Project.getActiveProject();

  if (!project) {
    return {
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
      frameSize: plainFrameSize(frameSize),
      playerPosition: plainTickTime(playerPosition),
      endTime: plainTickTime(endTime)
    ] = await Promise.all([
      sequence.getVideoTrackCount(),
      sequence.getAudioTrackCount(),
      sequence.getCaptionTrackCount(),
      sequence.getFrameSize(),
      sequence.getPlayerPosition(),
      sequence.getEndTime()
    ]);

    sequenceInfo = {
      guid: sequence.guid || null,
      name: sequence.name || null,
      videoTracks,
      audioTracks,
      captionTracks,
      frameSize,
      playerPosition,
      endTime
    };
  }

  return {
    premiereVersion: host?.version || null,
    uxpVersion: versions?.uxp || null,
    projectDetected: true,
    projectGuid: project.guid || null,
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
    sequenceGuid: sequence.guid || null,
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

async function summarizeTrackItem(item, clipIndex) {
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

  return {
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
      summaries.push(await summarizeTrackItem(item, clipIndex));
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
      summaries.push(await summarizeTrackItem(item, clipIndex));
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
    sequenceGuid: sequence.guid || null,
    sequenceName: sequence.name || null,
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

async function executeCommand(command) {
  switch (command.action) {
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
    case "attach_proxy":
      return await attachProxy(command.arguments || {});
    case "import_media":
      return await importMedia(command.arguments || {});
    case "create_sequence_from_media":
      return await createSequenceFromMedia(command.arguments || {});
    case "save_project":
      return await saveProject();
    case "inspect_timeline":
      return await inspectTimeline();
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
    case "add_effect_keyframe":
      return await addEffectKeyframe(command.arguments || {});
    case "list_audio_effects":
      return await listAudioEffects();
    case "inspect_audio_clip_effects":
      return await inspectAudioClipEffects(command.arguments || {});
    case "add_audio_effect":
      return await addAudioEffect(command.arguments || {});
    case "set_audio_effect_param":
      return await setAudioEffectParam(command.arguments || {});
    case "add_audio_effect_keyframe":
      return await addAudioEffectKeyframe(command.arguments || {});
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
    case "move_clip":
      return await moveClip(command.arguments || {});
    case "delete_clip":
      return await deleteClip(command.arguments || {});
    case "export_sequence":
      return await exportSequence(command.arguments || {});
    default:
      throw new Error("Unsupported Shuvi Premiere command: " + command.action);
  }
}

async function postResult(command, success, data, error) {
  await bridgeFetch(
    "/result",
    {
      method: "POST",
      body: JSON.stringify({
        id: command.id,
        success,
        data: success ? data : null,
        error: success ? null : String(error || "Unknown Premiere bridge error")
      })
    },
    4000
  );
}

async function pollBridge() {
  if (!bridgeToken || busy) return;

  busy = true;
  try {
    const command = await bridgeFetch("/command");

    setStatus("Connected to Shuvi", true);

    if (command && command.id && command.action) {
      show("Running: " + command.action);

      try {
        const data = await executeCommand(command);
        await postResult(command, true, data, null);
        show(JSON.stringify(data, null, 2));
      } catch (error) {
        await postResult(command, false, null, error);
        show("Command failed: " + String(error));
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
