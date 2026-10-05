(function () {
  "use strict";

  var BRIDGE_BASE = "http://127.0.0.1:17362";
  var bridgeToken = "";
  var pollTimer = null;
  var busy = false;
  var delivered = Object.create(null);
  var deliveredCount = 0;
  var inspectedCommands = Object.create(null);

  function el(id) { return document.getElementById(id); }
  function show(value) { var out = el("output"); if (out) out.textContent = value; }
  function setStatus(value, connected) {
    var node = el("bridgeStatus");
    if (!node) return;
    node.textContent = value;
    node.className = connected ? "connected" : "";
  }

  function evalHost(action, args) {
    return new Promise(function (resolve, reject) {
      if (!window.__adobe_cep__ || typeof window.__adobe_cep__.evalScript !== "function") {
        reject(new Error("Audition CEP evalScript is unavailable."));
        return;
      }
      var encoded = encodeURIComponent(JSON.stringify(args || {}));
      var script = "shuviAuditionDispatch(" + JSON.stringify(action) + "," + JSON.stringify(encoded) + ");";
      window.__adobe_cep__.evalScript(script, function (result) {
        try {
          if (!result || result === "EvalScript error.") throw new Error("Audition ExtendScript evaluation failed.");
          var envelope = eval("(" + result + ")");
          if (!envelope || envelope.ok !== true) throw new Error(envelope && envelope.error ? String(envelope.error) : "Audition host returned an invalid result.");
          resolve(envelope.data);
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  function bridgeRequest(method, path, body, token, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(method, BRIDGE_BASE + path, true);
      xhr.timeout = timeoutMs || 3000;
      xhr.setRequestHeader("X-Shuvi-Token", token);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var parsed = null;
        try { parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null; } catch (e) {}
        if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
        else reject(new Error(parsed && parsed.error ? parsed.error : "Bridge HTTP " + xhr.status));
      };
      xhr.onerror = function () { reject(new Error("Could not reach the Shuvi Audition bridge.")); };
      xhr.ontimeout = function () { reject(new Error("Shuvi Audition bridge request timed out.")); };
      xhr.send(body == null ? null : JSON.stringify(body));
    });
  }

  function claimCommand(command) {
    if (!command || typeof command.id !== "string" || !command.id || command.id.length > 80 ||
        typeof command.action !== "string" || !command.action || command.action.length > 80) {
      throw new Error("Invalid Shuvi Audition command identity.");
    }
    if (delivered[command.id]) throw new Error("Duplicate Audition command delivery rejected.");
    if (deliveredCount >= 1024) throw new Error("Pairing delivery budget exhausted; rotate the Shuvi pairing token.");
    delivered[command.id] = true;
    deliveredCount += 1;
  }

  function commandKey(property, value) { return String(property) + "\n" + String(value); }

  function rememberCommands(result) {
    inspectedCommands = Object.create(null);
    var rows = result && result.commands instanceof Array ? result.commands : [];
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i];
      if (row && typeof row.property === "string" && typeof row.value === "string") {
        inspectedCommands[commandKey(row.property, row.value)] = true;
      }
    }
  }

  function requireInspectedCommand(args) {
    if (!args || typeof args.property !== "string" || typeof args.value !== "string" ||
        !inspectedCommands[commandKey(args.property, args.value)]) {
      throw new Error("List Audition commands first, then use the exact inspected property/value pair.");
    }
  }

  function executeCommand(command) {
    var args = command.arguments || {};
    switch (command.action) {
      case "inspect_context":
        return evalHost("inspect_context", {});
      case "list_commands":
        return evalHost("list_commands", {}).then(function (result) {
          rememberCommands(result);
          return result;
        });
      case "script_dictionary":
        var query = args.query == null ? "" : String(args.query);
        var maxClasses = args.maxClasses == null ? 64 : Number(args.maxClasses);
        if (query.length > 120) return Promise.reject(new Error("Script Dictionary query exceeds 120 characters."));
        if (!isFinite(maxClasses) || Math.floor(maxClasses) !== maxClasses || maxClasses < 1 || maxClasses > 128) {
          return Promise.reject(new Error("Script Dictionary maxClasses must be an integer from 1 to 128."));
        }
        return evalHost("script_dictionary", {query: query, maxClasses: maxClasses});
      case "command_enabled":
        requireInspectedCommand(args);
        return evalHost("command_enabled", {property: args.property, value: args.value});
      case "set_playhead_percent":
        if (typeof args.percent !== "number" || !isFinite(args.percent) || args.percent < 0 || args.percent > 1) {
          return Promise.reject(new Error("Playhead percent must be between 0 and 1."));
        }
        return evalHost("set_playhead_percent", {percent: args.percent});
      case "invoke_command":
        requireInspectedCommand(args);
        return evalHost("invoke_command", {property: args.property, value: args.value});
      default:
        return Promise.reject(new Error("Unsupported Shuvi Audition command: " + command.action));
    }
  }

  function boundedResult(command, success, data, error) {
    var envelope = {
      id: command.id,
      action: command.action,
      success: success,
      data: success ? data : null,
      error: success ? null : String(error || "Unknown Audition bridge error").slice(0, 4000)
    };
    var body = JSON.stringify(envelope);
    if (body.length > 220000) {
      envelope = {
        id: command.id,
        action: command.action,
        success: false,
        data: null,
        error: "Audition result exceeded the bounded payload. The host action may have completed; inspect before retrying."
      };
    }
    return envelope;
  }

  function pollBridge() {
    if (!bridgeToken || busy) return;
    busy = true;
    var token = bridgeToken;

    bridgeRequest("GET", "/command", null, token, 2500)
      .then(function (command) {
        if (bridgeToken !== token) return null;
        setStatus("Connected to Shuvi", true);
        if (!command || !command.id || !command.action) return null;
        claimCommand(command);
        show("Running: " + command.action);
        return executeCommand(command)
          .then(function (data) {
            return bridgeRequest("POST", "/result", boundedResult(command, true, data, null), token, 4000)
              .then(function () { show(JSON.stringify(data, null, 2)); });
          })
          .catch(function (error) {
            return bridgeRequest("POST", "/result", boundedResult(command, false, null, error), token, 4000)
              .then(function () { show("Command failed: " + String(error)); });
          });
      })
      .catch(function (error) {
        setStatus("Not paired: " + String(error), false);
      })
      .then(function () { busy = false; }, function () { busy = false; });
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollBridge, 650);
    pollBridge();
  }

  function connectBridge() {
    var token = (el("tokenInput").value || "").trim();
    if (!token) {
      setStatus("Paste the pairing token from Shuvi.", false);
      return;
    }
    bridgeToken = token;
    delivered = Object.create(null);
    deliveredCount = 0;
    inspectedCommands = Object.create(null);
    setStatus("Connecting...", false);
    startPolling();
  }

  function disconnectBridge() {
    bridgeToken = "";
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    inspectedCommands = Object.create(null);
    setStatus("Disconnected", false);
  }

  function inspectNow() {
    evalHost("inspect_context", {})
      .then(function (data) { show(JSON.stringify(data, null, 2)); })
      .catch(function (error) { show("Audition inspection failed: " + String(error)); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    el("connect").addEventListener("click", connectBridge);
    el("disconnect").addEventListener("click", disconnectBridge);
    el("inspect").addEventListener("click", inspectNow);
    setStatus("Disconnected", false);
  });
}());
