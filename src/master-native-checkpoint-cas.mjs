// CAS-token verification belongs to the host revision issued by Rust.
// A task may adopt the host revision ONCE; later WebView writes never
// silently refresh a token after a process-level conflict.
const SHA=/^[0-9a-f]{64}$/;
export function checkedNativeCheckpointRevision(value){
 if(value===null)return null;
 if(typeof value!=="string"||!SHA.test(value))
  throw Error("Invalid native checkpoint revision from Rust host.");
 return value;
}
