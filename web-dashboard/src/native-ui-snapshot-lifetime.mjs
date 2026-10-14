// UI snapshot was obtained before an approved action which can modify the
// window tree. Mark the prior inventory stale until a *new* audited ui_windows.
const CHANGES=new Set(["ui_click","ui_set_value","ui_send_keys","ui_toggle","ui_focus",
 "ui_scroll","ui_expand_collapse","premiere_launch","launch_app"]);
export function invalidatesObservedWindows(tool){return CHANGES.has(tool);}
export function requiresNewWindowObservation(hasPriorInventory,verifiedTool){
 return hasPriorInventory===true&&invalidatesObservedWindows(verifiedTool);
}
