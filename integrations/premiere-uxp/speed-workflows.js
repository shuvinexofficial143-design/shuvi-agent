// CommonJS for Premiere UXP. Pure planning: never edits a clip or invokes UI.
const PRESETS = Object.freeze({ slow_motion: 0.5, fast_motion: 2, normal: 1 });
const SPEED_CAPABILITY = Object.freeze({
  status: "guarded_read_plan",
  adapter: "premiere_uxp",
  write_supported: false,
  readback_supported: true,
  planner_supported: true,
  reason: "The reviewed public UXP clip APIs expose getSpeed()/isSpeedReversed() reads but no documented speed, pitch, freeze or time-remapping write action.",
  reviewed: "2026-09-30",
  fallback: "User performs the reviewed plan in Premiere; no automatic UI fallback."
});

function finite(value, name, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function planSpeed(snapshot, request) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Speed request is required.");
  const allowed = {
    rate: ["rate"], duration: ["duration_seconds"], preset: ["preset"],
    ramp: ["points"], freeze: ["source_seconds", "duration_seconds"]
  }[request.mode];
  if (!allowed) throw new Error("Speed mode must be rate, duration, preset, ramp or freeze.");
  for (const key of Object.keys(request)) {
    if (!["mode", "reverse", "preserve_audio_pitch", ...allowed].includes(key)) throw new Error(`Unexpected speed field: ${key}`);
  }
  for (const key of ["reverse", "preserve_audio_pitch"]) {
    if (request[key] !== undefined && typeof request[key] !== "boolean") throw new Error(`${key} must be boolean.`);
  }
  const sourceIn = finite(snapshot.sourceInSeconds, "Source in", 0, 86400);
  const sourceOut = finite(snapshot.sourceOutSeconds, "Source out", 0, 86400);
  const sourceSpan = sourceOut - sourceIn;
  if (sourceSpan <= 0) throw new Error("Clip must have a positive source span.");
  const plan = {
    mode: request.mode,
    reverse: request.reverse ?? snapshot.reversed,
    preserve_audio_pitch: request.preserve_audio_pitch ?? null
  };
  if (plan.reverse !== null && typeof plan.reverse !== "boolean") throw new Error("Unknown reverse state; inspect again or explicitly supply reverse.");
  if (request.mode === "freeze") {
    plan.source_seconds = finite(request.source_seconds, "Freeze source time", sourceIn, sourceOut);
    if (plan.source_seconds === sourceOut) throw new Error("Freeze source time must precede the exclusive source out point.");
    plan.duration_seconds = finite(request.duration_seconds, "Freeze duration", 0.001, 86400);
  } else if (request.mode === "ramp") {
    const points = request.points;
    if (!Array.isArray(points) || points.length < 2 || points.length > 32) throw new Error("Ramp needs 2–32 source-relative points.");
    plan.points = points.map((point, index) => {
      if (!point || Object.keys(point).some(key => !["source_offset_seconds", "rate"].includes(key))) throw new Error("Invalid ramp point.");
      const time = finite(point.source_offset_seconds, "Ramp source offset", 0, sourceSpan);
      const rate = finite(point.rate, "Ramp rate", 0.01, 100);
      if (index && time <= points[index - 1].source_offset_seconds) throw new Error("Ramp source offsets must strictly increase.");
      return { source_offset_seconds: time, rate };
    });
    if (plan.points[0].source_offset_seconds !== 0 || Math.abs(plan.points.at(-1).source_offset_seconds - sourceSpan) > 1e-6) throw new Error("Ramp must cover the entire source span from zero.");
    // Rate varies linearly in source-time space. Integral dt = ds / rate(s).
    plan.duration_seconds = plan.points.slice(1).reduce((sum, point, index) => {
      const previous = plan.points[index];
      const span = point.source_offset_seconds - previous.source_offset_seconds;
      const delta = point.rate - previous.rate;
      return sum + (Math.abs(delta) < 1e-10 ? span / previous.rate : span * Math.log(point.rate / previous.rate) / delta);
    }, 0);
    plan.interpolation = "linear_in_source_time";
  } else {
    let rate;
    if (request.mode === "preset") {
      if (!Object.hasOwn(PRESETS, request.preset)) throw new Error("Unknown speed preset.");
      rate = PRESETS[request.preset];
      plan.preset = request.preset;
    } else if (request.mode === "duration") {
      rate = sourceSpan / finite(request.duration_seconds, "Target duration", 0.001, 86400);
    } else rate = request.rate;
    plan.rate = finite(rate, "Speed multiplier", 0.01, 100);
    plan.duration_seconds = sourceSpan / plan.rate;
  }
  finite(plan.duration_seconds, "Planned duration", 0.001, 86400);
  return {
    schemaVersion: 1, applied: false, executable: false,
    capability: SPEED_CAPABILITY, target: snapshot, plan,
    warnings: [
      "Planning uses the inspected source span; existing speed-remapping curves are not read or preserved.",
      "Durations are estimates before frame rounding; linked A/V, collisions and sync require review.",
      "Pitch/reverse requests are intent only; no native write or pitch preservation is claimed."
    ]
  };
}

module.exports = { planSpeed, SPEED_CAPABILITY };
