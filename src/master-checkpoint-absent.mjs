// Only Rust's exact absence result proves that the previous checkpoint was
// removed at this readback instant. Other values, including undefined or a
// newly-persisted checkpoint, never count as verified cleanup.
export function isNativeCheckpointAbsent(observed){return observed===null;}
