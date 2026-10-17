// Render accessibility and window labels only as bounded, normalized data.
// Strips invisible control / bidi formatting that can disguise UI labels.
export function cleanObservedLabel(value,limit=180){
 if(typeof value!=="string")return "";
 const max=Number.isSafeInteger(limit)&&limit>=1&&limit<=300?limit:180;
 return value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g," ")
  .replace(/\s+/g," ").trim().slice(0,max);
}

/** Exact proposal identity. No trim, BIDI, newline or invisible normalization
 * may silently turn a requested native selector into another UI target.
 * This is NOT a permission and does not replace Rust's native checks. */
export function exactUiSelector(value,max=180){
 return typeof value==="string"&&value.length>0&&value.length<=max&&
  value===value.trim()&&cleanObservedLabel(value,max)===value;
}
