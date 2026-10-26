export declare function nextAuditedUiMutationReadback(
 actionId:string,
 tool:string,
 pending:unknown,
 windows:unknown,
 nowMs?:number
):{proposal:{tool:"ui_windows"|"ui_find";arguments:Record<string,unknown>}}|{blocked:string}|null;
