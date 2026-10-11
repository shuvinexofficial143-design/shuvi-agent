// A provider or failed native invocation can include raw authentication secrets.
// Display only a bounded, credential-redacted error string to the owner.
function sanitize(input,limit){
 const value=String(input??"Unknown error");
 // Never truncate a credential *before* redaction; that leaks its prefix.
 if(value.length>100000)return "[OVERSIZED_DIAGNOSTIC_OMITTED]";
 const message=value;
 return message
  .replace(/\b(sk-[A-Za-z0-9_-]{12,})\b/g,"[REDACTED_API_KEY]")
  .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi,"$1[REDACTED_TOKEN]")
  .replace(/((?:api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)["']?[A-Za-z0-9._~+/-]{8,}["']?/gi,"$1[REDACTED]")
  .replace(/([?&](?:api[_-]?key|access[_-]?token|token|key)=)[^&#\s]{8,}/gi,"$1[REDACTED]")
  .replace(/((?:x-api-key|x-auth-token)\s*:\s*)[^\s,;]+/gi,"$1[REDACTED]")
  .replace(/(["'](?:api[_-]?key|access[_-]?token|secret|authorization)["']\s*:\s*["'])[^"'\r\n]{8,}(["'])/gi,"$1[REDACTED]$2")
  .slice(0,limit);
}

export const redactNativeError=input=>sanitize(input,2400);
export const redactNativeOutput=input=>sanitize(input,7000);
export const redactNativeMessage=input=>sanitize(input,12000);
