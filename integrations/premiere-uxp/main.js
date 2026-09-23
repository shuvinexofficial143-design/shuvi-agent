const { entrypoints } = require("uxp");
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

async function inspectActiveContext() {
  const project = await premiere.Project.getActiveProject();

  if (!project) {
    return {
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
  const project = await premiere.Project.getActiveProject();
  if (!project) throw new Error("No active Premiere project.");

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

async function importMedia(argumentsValue) {
  const paths = Array.isArray(argumentsValue?.paths)
    ? argumentsValue.paths.filter((value) => typeof value === "string" && value.trim())
    : [];

  if (!paths.length) throw new Error("No media paths were supplied.");
  if (paths.length > 100) throw new Error("A maximum of 100 files can be imported per command.");

  const project = await premiere.Project.getActiveProject();
  if (!project) throw new Error("No active Premiere project.");

  const root = await project.getRootItem();
  const success = await project.importFiles(paths, true, root, false);

  if (!success) throw new Error("Premiere reported that media import did not complete.");

  return {
    imported: paths.length,
    projectName: project.name || null
  };
}

async function executeCommand(command) {
  switch (command.action) {
    case "inspect_context":
      return await inspectActiveContext();
    case "list_root_items":
      return await listRootItems();
    case "import_media":
      return await importMedia(command.arguments || {});
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
        // Keep the short polling loop active while Premiere is running so Shuvi can finish a task.
      },
      destroy() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
      }
    }
  }
});
