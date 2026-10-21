// Live recovery control diagnostics. No authorization or journal mutation.
export function recoveryButtonState({ready,sending,pending,phase,disabled}){
 const reason=!ready?"native_runtime_not_ready":pending?"pending_action_approval":
  sending?"native_request_or_recovery_in_flight":disabled?"dom_disabled":
  !phase?"no_recovery_journal":"owner_action_available";
 return {reason,canClear:reason==="owner_action_available",
  phase:phase??"none",domDisabled:disabled===true};
}
