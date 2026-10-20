// A provider or failed native invocation can include raw authentication secrets.
// Display only a bounded, credential-redacted error string to the owner.
function sanitize(input,limit){
 const value=String(input??"Unknown error");
 // Never truncate a credential *before* redaction; that leaks its prefix.
 if(value.length>100000)return "[OVERSIZED_DIAGNOSTIC_OMITTED]";
 const message=value;
 return message
  .replace(/sk-[A-Za-z0-9_-]{12,}/g,"[REDACTED_API_KEY]")
  .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]{8,}/gi,"$1[REDACTED_TOKEN]")
  .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|authorization)\s*[:=]\s*)["']?[A-Za-z0-9._~+/-]{8,}["']?/gi,"$1[REDACTED]")
  .replace(/([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|token|key)=)[^&#\s]{8,}/gi,"$1[REDACTED]")
  .replace(/((?:x-api-key|x-auth-token)\s*:\s*)[^\s,;]+/gi,"$1[REDACTED]")
  .replace(/(["'](?:api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|password|secret|authorization)["']\s*:\s*["'])[^"'\r\n]{8,}(["'])/gi,"$1[REDACTED]$2")
  .slice(0,limit);
}

export const redactNativeError=input=>sanitize(input,2400);
export const redactNativeOutput=input=>sanitize(input,7000);
export const redactNativeMessage=input=>sanitize(input,12000);

// Provider tool JSON is an internal control envelope, not normal Chat prose.
// Keep the structured proposal on the approval path, but never echo raw or
// duplicated JSON into the owner-facing native conversation.
export function nativeAssistantDisplay(input,proposal=null){
 const safe=redactNativeMessage(input);
 const tool=proposal&&typeof proposal.tool==="string"?proposal.tool.trim():"";
 const trimmed=safe.trim();
 if(tool&&(!trimmed||trimmed.startsWith("{")))
  return "I need permission to use "+tool.replaceAll("_"," ")+" before I continue.";
 if(trimmed.startsWith("{")&&trimmed.endsWith("}")){
  try{
   const value=JSON.parse(trimmed);
   if(value&&typeof value.tool==="string")
    return "The AI proposed "+value.tool.replaceAll("_"," ")+
     ", but Shuvi did not prepare it. No Windows action was prepared or executed.";
  }catch{/* malformed provider JSON is still not normal prose */}
 }
 if(/\"tool\"\s*:/.test(trimmed))
  return "The AI returned tool data that Shuvi could not safely display or prepare. No Windows action was prepared or executed.";
 return safe;
}
