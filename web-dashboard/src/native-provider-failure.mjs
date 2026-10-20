// Classify trusted native provider errors without confusing a failed model
// request with the outcome of an already audited Windows action.
const HTTP=/^(?:Provider|Gemini|Anthropic) returned (429|500|502|503|504)\b/;
export function classifyNativeProviderFailure(error){
 const message=error instanceof Error?error.message:String(error??"");
 const response=HTTP.exec(message);
 if(response)return {kind:"http_response",status:Number(response[1]),requestMayHaveBeenBilled:true};
 if(/\b(?:timed?\s*out|timeout)\b/i.test(message))
  return {kind:"timeout",status:null,requestMayHaveBeenBilled:true};
 return {kind:"transport_or_unknown",status:null,requestMayHaveBeenBilled:true};
}
