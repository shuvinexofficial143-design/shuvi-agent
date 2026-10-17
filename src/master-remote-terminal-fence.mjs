// A source/client-only fence. A terminal remote command is retired only
// after the server acknowledges the exact same task's receipt. It does not
// claim OS execution success or alter Rust remote protocol authority.
export function terminalRemoteReceiptClearAllowed(original,current,acknowledged){
 return original!==null&&typeof original==="object"&&
   original===current&&acknowledged===true;
}
