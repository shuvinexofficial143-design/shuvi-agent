// Native tool state -> simple, non-technical Hindi. Never source the
// conversational message from untrusted stdout, PID/HWND or model JSON.
export function nativeReadProgress(proposal){
 switch(proposal?.tool){
  case "ui_windows":return "मैं ऐप की खुली हुई विंडो जाँच रही हूँ। अभी आपका काम पूरा नहीं माना है।";
  case "ui_discover":return "ऐप की विंडो मिल गई है। अब उसका इंटरफ़ेस इस्तेमाल के लिए तैयार है या नहीं, यह जाँच रही हूँ।";
  case "ui_find":return "मैं सही कंट्रोल की पहचान जाँच रही हूँ।";
  case "browser_page_state":return "वेबपेज सही तरीके से खुला है या नहीं, यह जाँच रही हूँ।";
  default:return "पिछली जाँच पूरी हुई है। अब अगला सुरक्षित Read-only कदम जाँच रही हूँ।";
 }
}
