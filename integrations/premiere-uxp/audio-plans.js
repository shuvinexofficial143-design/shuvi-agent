function buildAudioPlan(request, selector, inspected) {
  const {mode, duration_seconds: duration, baseline, target_value: targetValue, value_unit: unit} = request;
  if (!["duck", "fade_in", "fade_out", "pan"].includes(mode)) throw new Error("Unknown audio plan mode.");
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86400 || !Number.isFinite(baseline)) throw new Error("Bounded duration and finite baseline are required.");
  if (!inspected.keyframesSupported) throw new Error("Inspected audio parameter does not support keyframes.");
  if (inspected.timeVarying) throw new Error("Audio planner requires an unanimated parameter; inspect/remove existing keys explicitly first.");
  if (typeof inspected.current !== "number" || !Number.isFinite(inspected.current) || Math.abs(inspected.current - baseline) > 1e-9) throw new Error("Baseline must equal the inspected native parameter value.");
  if (!["db", "linear_amplitude", "native"].includes(unit)) throw new Error("Explicit value_unit must be db, linear_amplitude or native.");
  let reduced = targetValue;
  if (request.reduction_db != null) {
    if (mode !== "duck" || targetValue != null || !Number.isFinite(request.reduction_db) || request.reduction_db <= 0 || request.reduction_db > 60 || unit === "native") throw new Error("Ducking reduction requires 0–60 dB, a known dB/amplitude unit and no target_value.");
    reduced = unit === "db" ? baseline - request.reduction_db : baseline * Math.pow(10, -request.reduction_db / 20);
  }
  if (!Number.isFinite(reduced)) throw new Error("Finite native target value required.");
  const min = unit === "db" ? -96 : unit === "linear_amplitude" ? 0 : request.min;
  const max = unit === "db" ? 24 : unit === "linear_amplitude" ? 16 : request.max;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || Math.min(baseline, reduced) < min || Math.max(baseline, reduced) > max) throw new Error("Audio values exceed declared native bounds.");
  const points = new Map(); const add = (seconds, value) => points.set(seconds, value);
  const merged = [];
  if (mode === "duck") {
    if (reduced >= baseline) throw new Error("Ducked target must be below baseline.");
    const attack = request.attack_seconds, release = request.release_seconds;
    if (![attack, release].every(v => Number.isFinite(v) && v > 0 && v <= 30)) throw new Error("Attack/release must be positive and at most 30 seconds.");
    const regions = request.regions;
    if (!Array.isArray(regions) || !regions.length || regions.length > 128) throw new Error("Supply 1–128 structured dialogue regions; no speech detector is connected.");
    for (const region of regions) if (!Number.isFinite(region.start) || !Number.isFinite(region.end) || region.start < 0 || region.end <= region.start || region.end > duration) throw new Error("Dialogue regions must lie inside the declared native parameter duration.");
    for (const region of [...regions].sort((a, b) => a.start - b.start)) {
      const previous = merged[merged.length - 1];
      if (previous && region.start - attack <= previous.end + release) previous.end = Math.max(previous.end, region.end);
      else merged.push({start: region.start, end: region.end});
    }
    add(0, baseline);
    for (const region of merged) {
      add(Math.max(0, region.start - attack), baseline); add(region.start, reduced);
      add(region.end, reduced);
      if (region.end < duration) add(Math.min(duration, region.end + release), baseline);
    }
    if (merged[merged.length - 1].end < duration) add(duration, baseline);
  } else {
    if (request.regions?.length || request.reduction_db != null) throw new Error("Dialogue regions/reduction apply only to ducking.");
    if (mode === "fade_in" && reduced <= baseline || mode === "fade_out" && reduced >= baseline) throw new Error("Fade target must follow the requested direction.");
    add(0, baseline); add(duration, reduced);
  }
  const settings = [...points].sort((a, b) => a[0] - b[0]).map(([seconds, value]) => ({...selector, seconds, value}));
  if (settings.length > 64) throw new Error("Plan exceeds 64 keys; shorten or split the inspected region input.");
  return {schemaVersion: 1, mode, applied: false, analysisSource: "supplied_regions", automaticSpeechDetection: false,
    timeDomain: "native_parameter_seconds", settings, mergedRegions: merged, executionTool: "premiere_apply_audio_recipe",
    warnings: ["Caller must map dialogue timing to the target parameter time domain and declare its verified value unit.", "Overlapping attack/release envelopes remain ducked across the gap.", "Interpolation follows host default behavior; inspect keyframes and audition the result before acceptance."]};
}
module.exports = {buildAudioPlan};
