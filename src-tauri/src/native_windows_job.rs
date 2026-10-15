//! Windows-owned worker process tree. Start suspended, attach to a
//! kill-on-close Job Object, then resume. No model-supplied native command.
use std::{
    ffi::{c_void,OsStr,OsString},io,mem,
    os::windows::ffi::OsStrExt,path::Path,ptr::{null,null_mut},
    thread,time::{Instant,Duration}
};
type Handle=*mut c_void;
const CREATE_SUSPENDED:u32=0x4;
const CREATE_NO_WINDOW:u32=0x08000000;
const CREATE_UNICODE_ENVIRONMENT:u32=0x400;
const JOB_EXTENDED_LIMIT:u32=9;
const JOB_BASIC_ACCOUNTING:u32=1;
const KILL_ON_CLOSE:u32=0x2000;
const WAIT_OBJECT_0:u32=0;
const WAIT_TIMEOUT:u32=258;
#[repr(C)]#[derive(Default)]
struct BasicLimit {
    process_time:i64,job_time:i64,flags:u32,
    min_working_set:usize,max_working_set:usize,
    active_process_limit:u32,affinity:usize,priority_class:u32,scheduling_class:u32
}
#[repr(C)]#[derive(Default)]
struct IoCounters {
    read_ops:u64,write_ops:u64,other_ops:u64,
    read_bytes:u64,write_bytes:u64,other_bytes:u64
}
#[repr(C)]#[derive(Default)]
struct ExtendedLimit {
    basic:BasicLimit,io:IoCounters,
    process_memory:usize,job_memory:usize,
    peak_process_memory:usize,peak_job_memory:usize
}
#[repr(C)]#[derive(Default)]
struct Accounting {
    user_time:i64,kernel_time:i64,period_user:i64,period_kernel:i64,
    page_faults:u32,total_processes:u32,active_processes:u32,terminated:u32
}
#[repr(C)]
struct StartupInfoW {
    cb:u32,reserved:*mut u16,desktop:*mut u16,title:*mut u16,
    x:u32,y:u32,width:u32,height:u32,chars_x:u32,chars_y:u32,
    fill:u32,flags:u32,show:u16,reserved2:u16,reserved_ptr:*mut u8,
    input:Handle,output:Handle,error:Handle
}
#[repr(C)]
struct ProcessInfo {process:Handle,thread:Handle,pid:u32,tid:u32}
#[link(name="kernel32")]
extern "system" {
    fn CreateJobObjectW(attrs:*const c_void,name:*const u16)->Handle;
    fn SetInformationJobObject(job:Handle,kind:u32,info:*const c_void,len:u32)->i32;
    fn AssignProcessToJobObject(job:Handle,process:Handle)->i32;
    fn QueryInformationJobObject(job:Handle,kind:u32,info:*mut c_void,len:u32,out:*mut u32)->i32;
    fn TerminateJobObject(job:Handle,code:u32)->i32;
    fn CreateProcessW(
        app:*const u16,cmd:*mut u16,pattrs:*mut c_void,tattrs:*mut c_void,
        inherit:i32,flags:u32,env:*mut c_void,cwd:*const u16,
        start:*mut StartupInfoW,info:*mut ProcessInfo
    )->i32;
    fn ResumeThread(thread:Handle)->u32;
    fn GetExitCodeProcess(process:Handle,code:*mut u32)->i32;
    fn WaitForSingleObject(handle:Handle,ms:u32)->u32;
    fn TerminateProcess(process:Handle,code:u32)->i32;
    fn CloseHandle(handle:Handle)->i32;
}
struct OwnedHandle(Handle);
impl Drop for OwnedHandle {
    fn drop(&mut self){if !self.0.is_null(){unsafe{CloseHandle(self.0);}}}
}
fn wide(s:&OsStr)->Vec<u16>{s.encode_wide().chain([0]).collect()}
fn quote(arg:&OsStr)->Vec<u16>{
    let mut result=vec![34];
    let mut slashes=0;
    for c in arg.encode_wide(){
        if c==92{slashes+=1;continue;}
        if c==34{
            result.extend(std::iter::repeat(92).take(slashes*2+1));
            result.push(34);slashes=0;
        } else {
            result.extend(std::iter::repeat(92).take(slashes));
            slashes=0;result.push(c);
        }
    }
    result.extend(std::iter::repeat(92).take(slashes*2));
    result.push(34);result
}
fn args_to_commandline(exe:&Path,args:&[OsString])->Vec<u16>{
    let mut cmd=quote(exe.as_os_str());
    for arg in args {cmd.push(32);cmd.extend(quote(arg.as_os_str()));}
    cmd.push(0);cmd
}
fn minimal_environment()->Vec<u16>{
    let mut block=Vec::new();
    for name in ["SystemRoot","WINDIR","TEMP","TMP"]{
        if let Some(value)=std::env::var_os(name){
            block.extend(OsStr::new(name).encode_wide());
            block.push(61);block.extend(value.encode_wide());block.push(0);
        }
    }
    block.push(0);
    if block.len()==1{block.push(0);}
    block
}
fn error(context:&str)->String{format!("{context}: {}",io::Error::last_os_error())}
pub(super) struct OwnedChild { job:OwnedHandle,process:OwnedHandle,pid:u32 }
impl OwnedChild{
    pub(super) fn spawn(exe:&Path,args:&[OsString],cwd:&Path)->Result<Self,String>{
        let job=unsafe{CreateJobObjectW(null(),null())};
        if job.is_null(){return Err(error("CreateJobObjectW failed"));}
        let job=OwnedHandle(job);
        let mut limit=ExtendedLimit::default();
        limit.basic.flags=KILL_ON_CLOSE;
        let ok=unsafe{SetInformationJobObject(job.0,JOB_EXTENDED_LIMIT,
            &limit as *const _ as *const c_void,mem::size_of::<ExtendedLimit>() as u32)};
        if ok==0{return Err(error("Worker kill-on-close protection unavailable"));}
        let app=wide(exe.as_os_str());
        let mut cmd=args_to_commandline(exe,args);
        let cwd=wide(cwd.as_os_str());
        let mut environment=minimal_environment();
        let mut start:StartupInfoW=unsafe{mem::zeroed()};
        start.cb=mem::size_of::<StartupInfoW>() as u32;
        let mut info:ProcessInfo=unsafe{mem::zeroed()};
        // Suspended process cannot launch descendants before job assignment.
        let ok=unsafe{CreateProcessW(app.as_ptr(),cmd.as_mut_ptr(),null_mut(),
            null_mut(),0,CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT,
            environment.as_mut_ptr() as *mut c_void,cwd.as_ptr(),&mut start,&mut info)};
        if ok==0{return Err(error("Cannot start suspended worker"));}
        let process=OwnedHandle(info.process);
        let primary=OwnedHandle(info.thread);
        let assigned=unsafe{AssignProcessToJobObject(job.0,process.0)};
        if assigned==0 {
            let why=error("Worker process containment failed");
            unsafe{TerminateProcess(process.0,1);WaitForSingleObject(process.0,5000);}
            return Err(why);
        }
        let resumed=unsafe{ResumeThread(primary.0)};
        if resumed==u32::MAX{
            let why=error("Cannot resume contained worker");
            unsafe{TerminateJobObject(job.0,1);WaitForSingleObject(process.0,5000);}
            return Err(why);
        }
        Ok(Self{job,process,pid:info.pid})
    }
    pub(super) fn id(&self)->u32{self.pid}
    pub(super) fn tree_contained(&self)->bool{true}
    pub(super) fn active_processes(&self)->Result<u32,String>{
        let mut info=Accounting::default();
        let ok=unsafe{QueryInformationJobObject(self.job.0,JOB_BASIC_ACCOUNTING,
            &mut info as *mut _ as *mut c_void,mem::size_of::<Accounting>() as u32,null_mut())};
        if ok==0{Err(error("Cannot inspect worker Job Object"))}
        else{Ok(info.active_processes)}
    }
    pub(super) fn try_wait(&mut self)->Result<Option<i32>,String>{
        match unsafe{WaitForSingleObject(self.process.0,0)} {
            WAIT_TIMEOUT=>Ok(None),
            WAIT_OBJECT_0=>{
                let mut code=0u32;
                if unsafe{GetExitCodeProcess(self.process.0,&mut code)}==0{
                    Err(error("Cannot inspect worker exit code"))
                }else{Ok(Some(code as i32))}
            },
            _=>Err(error("Cannot wait on owned process"))
        }
    }
    pub(super) fn terminate_tree(&mut self)->Result<Option<i32>,String>{
        if unsafe{TerminateJobObject(self.job.0,1)}==0{
            return Err(error("Cannot terminate exact worker job"));
        }
        let deadline=Instant::now()+Duration::from_secs(5);
        loop {
            if self.active_processes()?==0{return self.try_wait();}
            if Instant::now()>=deadline{
                return Err("Owned worker descendants have not terminated".into());
            }
            thread::sleep(Duration::from_millis(10));
        }
    }
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn win64_layout_contract_for_job_object_calls(){
        #[cfg(target_pointer_width="64")]{
            assert_eq!(mem::size_of::<BasicLimit>(),64);
            assert_eq!(mem::size_of::<ExtendedLimit>(),144);
            assert_eq!(mem::size_of::<Accounting>(),48);
        }
    }
    #[test]
    fn command_quote_escapes_trailing_backslashes(){
        let encoded=String::from_utf16(&quote(OsStr::new("path\\"))).unwrap();
        assert_eq!(encoded,"\"path\\\\\"");
    }
}
