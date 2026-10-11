// A provider or failed native invocation can include raw authentication secrets.
// Display only a bounded, credential-redacted error string to the owner.
export function redactNativeError(input){
 const message=String(input??"Unknown error").slice(0,2400);
 return message
  .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g,"[REDACTED_API_KEY]")
  .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi,"$1[REDACTED_TOKEN]")
  .replace(/((?:api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)["']?[A-Za-z0-9._~+/-]{8,}["']?/gi,"$1[REDACTED]");
}
