// Guard new Master provider calls against unfinished REAL Rust mutations.
// An observed supervisor tick or a queued WebView step is not execution proof.
export function assessMasterSchedulerAdmission(schedule,graph){
  if(graph==null)return {ok:true,reason:null};
  if(schedule===undefined)return {ok:false,reason:"Native scheduler is not readable."};
  if(schedule===null)return {ok:true,reason:null};
  if(schedule.version!==1||typeof schedule.objective!=="string"
      ||!Array.isArray(schedule.jobs)||schedule.jobs.length<1||schedule.jobs.length>48
      ||schedule.jobs.some(job=>!job||typeof job.stepId!=="string"
        ||typeof job.tool!=="string"||!Array.isArray(job.dependsOn)
        ||!["queued","running","audited","failed","outcome_unknown","reviewed_failed"].includes(job.phase))){
    return {ok:false,reason:"Native scheduler checkpoint is malformed."};
  }
  if(schedule.jobs.some(job=>job.phase==="running")){
    return {ok:false,reason:"A native action remains running or uncertain; inspect the Rust journal before another Master AI turn."};
  }
  return {ok:true,reason:null};
}
