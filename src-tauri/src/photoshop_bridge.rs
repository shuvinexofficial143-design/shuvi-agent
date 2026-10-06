use std::{
    io::{Read,Write},
    net::{TcpListener,TcpStream},
    sync::{Arc,Mutex,atomic::{AtomicUsize,Ordering}},
    thread,
    time::{Duration,SystemTime,UNIX_EPOCH},
};
use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use uuid::Uuid;
use super::photoshop_bridge_queue::CommandQueue;

pub const PHOTOSHOP_BRIDGE_PORT:u16=17_363;
pub const READ_ONLY_ACTIONS:&[&str]=&["inspect_context","list_layers"];
pub const MUTATING_ACTIONS:&[&str]=&["set_layer_property","set_text_layer","transform_layer","set_layer_mask","save_document"];
pub const ALLOWED_ACTIONS:&[&str]=&["inspect_context","list_layers","set_layer_property","set_text_layer","transform_layer","set_layer_mask","save_document"];

const MAX_BODY_BYTES:usize=256*1024;
const MAX_HEADER_BYTES:usize=16*1024;

#[derive(Debug,Clone,Serialize,Deserialize)]
pub struct PhotoshopBridgeCommand{
    pub id:String,
    pub action:String,
    pub arguments:Value,
}

#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhotoshopBridgeResult{
    pub id:String,
    pub action:String,
    pub success:bool,
    pub data:Option<Value>,
    pub error:Option<String>,
}

#[derive(Debug,Clone,Serialize)]
pub struct PhotoshopBridgeStatus{
    pub enabled:bool,
    pub server_started:bool,
    pub paired:bool,
    pub port:u16,
    pub token:Option<String>,
    pub last_seen_ms:Option<u64>,
    pub queued_commands:usize,
    pub read_only:bool,
}

#[derive(Default)]
pub struct PhotoshopBridgeShared{
    server_started:Mutex<bool>,
    enabled:Mutex<bool>,
    token:Mutex<Option<String>>,
    token_created:Mutex<Option<std::time::Instant>>,
    active_clients:AtomicUsize,
    work:Mutex<CommandQueue>,
    last_seen_ms:Mutex<Option<u64>>,
}

fn now_ms()->u64{
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default()
        .as_millis().min(u64::MAX as u128) as u64
}

impl PhotoshopBridgeShared{
    pub fn start(self:&Arc<Self>)->Result<PhotoshopBridgeStatus,String>{
        let mut started=self.server_started.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?;
        if !*started{
            let listener=TcpListener::bind(("127.0.0.1",PHOTOSHOP_BRIDGE_PORT))
                .map_err(|e|format!("Could not bind Photoshop bridge to 127.0.0.1:{PHOTOSHOP_BRIDGE_PORT}: {e}"))?;
            let shared=Arc::clone(self);
            thread::Builder::new().name("shuvi-photoshop-bridge".into()).spawn(move||{
                for stream in listener.incoming(){
                    let Ok(stream)=stream else{continue};
                    let shared=Arc::clone(&shared);
                    if shared.active_clients.fetch_update(Ordering::AcqRel,Ordering::Relaxed,
                        |count|(count<16).then_some(count+1)).is_err(){continue;}
                    let guard=ClientGuard(Arc::clone(&shared));
                    let _=thread::Builder::new().name("shuvi-photoshop-client".into()).spawn(move||{
                        let _guard=guard;
                        handle_client(stream,shared);
                    });
                }
            }).map_err(|e|format!("Could not start Photoshop bridge thread: {e}"))?;
            *started=true;
        }

        let token=Uuid::new_v4().simple().to_string();
        *self.token_created.lock().map_err(|_|"Photoshop token clock is unavailable.".to_string())?=Some(std::time::Instant::now());
        *self.token.lock().map_err(|_|"Photoshop token state is unavailable.".to_string())?=Some(token);
        *self.enabled.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?=true;
        *self.last_seen_ms.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?=None;
        self.work.lock().map_err(|_|"Photoshop queue is unavailable.".to_string())?.clear();
        drop(started);
        self.status()
    }

    pub fn stop(&self)->Result<PhotoshopBridgeStatus,String>{
        *self.enabled.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?=false;
        *self.token.lock().map_err(|_|"Photoshop token state is unavailable.".to_string())?=None;
        *self.last_seen_ms.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?=None;
        self.work.lock().map_err(|_|"Photoshop queue is unavailable.".to_string())?.clear();
        self.status()
    }

    pub fn status(&self)->Result<PhotoshopBridgeStatus,String>{
        let enabled=*self.enabled.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?
            && self.token_is_current();
        let server_started=*self.server_started.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?;
        let token=self.token.lock().map_err(|_|"Photoshop token state is unavailable.".to_string())?.clone();
        let last_seen_ms=*self.last_seen_ms.lock().map_err(|_|"Photoshop bridge state is unavailable.".to_string())?;
        let queued_commands={
            let mut work=self.work.lock().map_err(|_|"Photoshop queue is unavailable.".to_string())?;
            work.cleanup(std::time::Instant::now());
            work.queued_len()
        };
        let paired=enabled&&last_seen_ms.map(|seen|now_ms().saturating_sub(seen)<=4_000).unwrap_or(false);
        Ok(PhotoshopBridgeStatus{
            enabled,server_started,paired,port:PHOTOSHOP_BRIDGE_PORT,
            token:if enabled{token}else{None},last_seen_ms,queued_commands,read_only:false
        })
    }

    pub async fn request(&self,action:&str,arguments:Value,timeout:Duration)->Result<Value,String>{
        if !ALLOWED_ACTIONS.contains(&action){return Err("Photoshop action is not in the bounded bridge allowlist.".into());}
        let mutating=MUTATING_ACTIONS.contains(&action);
        if timeout.is_zero()||timeout>Duration::from_secs(60){return Err("Photoshop read-only timeout must be between 1 ms and 60 seconds.".into());}
        let status=self.status()?;
        if !status.enabled{return Err("Photoshop bridge is not enabled.".into());}
        if !status.paired{return Err("Photoshop UXP panel is not paired with Shuvi.".into());}
        let id=Uuid::new_v4().to_string();
        let command=PhotoshopBridgeCommand{id:id.clone(),action:action.into(),arguments};
        let encoded=serde_json::to_vec(&command).map_err(|e|format!("Invalid Photoshop command: {e}"))?;
        if encoded.len()>64*1024{return Err("Photoshop read-only command exceeds 64 KiB.".into());}
        {
            let mut work=self.work.lock().map_err(|_|"Photoshop queue is unavailable.".to_string())?;
            if !self.authenticate(status.token.as_deref()){return Err("Photoshop pairing changed before enqueueing.".into());}
            work.enqueue(command,timeout)?;
        }
        let _guard=PendingGuard{shared:self,id:id.clone()};
        loop{
            if !self.authenticate(status.token.as_deref()){
                return Err(if mutating{
                    "execution_status_unknown: Photoshop pairing ended after a guarded mutation may have been dispatched; inspect exact document/layer state before retrying.".into()
                }else{"Photoshop pairing ended or expired.".into()});
            }
            let result={
                let mut work=self.work.lock().map_err(|_|"Photoshop queue is unavailable.".to_string())?;
                work.take_result(&id).map_err(|error|{
                    if mutating{format!("execution_status_unknown: {error} Inspect exact Photoshop document/layer state before retrying.")}
                    else{error}
                })?
            };
            if let Some(result)=result{
                if result.success{return Ok(result.data.unwrap_or(Value::Null));}
                let error=result.error.unwrap_or_else(||"Photoshop command failed.".into());
                return Err(if mutating{format!("execution_status_unknown: {error} Inspect exact Photoshop document/layer state before retrying.")}else{error});
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    fn authenticate(&self,supplied:Option<&str>)->bool{
        if !self.enabled.lock().map(|v|*v).unwrap_or(false)||!self.token_is_current(){return false;}
        let expected=self.token.lock().ok().and_then(|v|v.clone());
        expected.as_deref().is_some_and(|v|Some(v)==supplied)
    }

    fn token_is_current(&self)->bool{
        self.token_created.lock().ok().and_then(|v|*v)
            .is_some_and(|created|created.elapsed()<Duration::from_secs(8*60*60))
    }

    fn mark_seen(&self){
        if let Ok(mut seen)=self.last_seen_ms.lock(){*seen=Some(now_ms());}
    }
}

struct PendingGuard<'a>{shared:&'a PhotoshopBridgeShared,id:String}
impl Drop for PendingGuard<'_>{
    fn drop(&mut self){if let Ok(mut work)=self.shared.work.lock(){work.remove(&self.id);}}
}
struct ClientGuard(Arc<PhotoshopBridgeShared>);
impl Drop for ClientGuard{
    fn drop(&mut self){self.0.active_clients.fetch_sub(1,Ordering::AcqRel);}
}

struct HttpRequest{method:String,path:String,token:Option<String>,body:Vec<u8>}

fn parse_headers(headers:&str)->Result<(String,String,Option<String>,usize),String>{
    let mut lines=headers.split("\r\n");
    let parts:Vec<_>=lines.next().unwrap_or_default().split_whitespace().collect();
    if parts.len()!=3||!matches!(parts[2],"HTTP/1.1"|"HTTP/1.0"){return Err("Malformed Photoshop HTTP request line.".into());}
    let mut token=None;
    let mut length=None;
    for line in lines.filter(|line|!line.is_empty()){
        let (name,value)=line.split_once(':').ok_or("Malformed Photoshop HTTP header.")?;
        let value=value.trim();
        if name.eq_ignore_ascii_case("transfer-encoding"){return Err("Chunked Photoshop bridge requests are unsupported.".into());}
        if name.eq_ignore_ascii_case("content-length"){
            if length.is_some(){return Err("Duplicate Content-Length.".into());}
            if value.is_empty()||!value.bytes().all(|v|v.is_ascii_digit()){return Err("Invalid Content-Length.".into());}
            let size=value.parse::<usize>().map_err(|_|"Invalid Content-Length.".to_string())?;
            if size>MAX_BODY_BYTES{return Err("Photoshop request body exceeds 256 KiB.".into());}
            length=Some(size);
        }
        if name.eq_ignore_ascii_case("x-shuvi-token"){
            if token.is_some(){return Err("Duplicate pairing token header.".into());}
            token=Some(value.to_string());
        }
    }
    if parts[0]=="POST"&&length.is_none(){return Err("POST requires Content-Length.".into());}
    Ok((parts[0].into(),parts[1].into(),token,length.unwrap_or(0)))
}

fn read_request(stream:&mut TcpStream)->Result<HttpRequest,String>{
    let deadline=std::time::Instant::now()+Duration::from_secs(2);
    let mut buffer=Vec::new();
    let mut chunk=[0u8;4096];
    let mut parsed=None;
    loop{
        let remaining=deadline.checked_duration_since(std::time::Instant::now())
            .filter(|d|!d.is_zero()).ok_or("Photoshop request read deadline exceeded.")?;
        stream.set_read_timeout(Some(remaining)).map_err(|e|format!("Socket timeout: {e}"))?;
        let count=stream.read(&mut chunk).map_err(|e|format!("Could not read Photoshop request: {e}"))?;
        if count==0{return Err("Truncated Photoshop HTTP request.".into());}
        buffer.extend_from_slice(&chunk[..count]);
        if buffer.len()>MAX_BODY_BYTES+MAX_HEADER_BYTES{return Err("Photoshop request exceeds payload limits.".into());}
        if parsed.is_none(){
            if let Some(end)=buffer.windows(4).position(|w|w==b"\r\n\r\n").map(|i|i+4){
                if end>MAX_HEADER_BYTES{return Err("Photoshop headers exceed 16 KiB.".into());}
                let headers=std::str::from_utf8(&buffer[..end]).map_err(|_|"Photoshop HTTP headers must be UTF-8.".to_string())?;
                parsed=Some((end,parse_headers(headers)?));
            }else if buffer.len()>MAX_HEADER_BYTES{return Err("Photoshop headers exceed 16 KiB.".into());}
        }
        if let Some((end,(method,path,token,length)))=&parsed{
            let expected=end+length;
            if buffer.len()>=expected{
                if buffer.len()!=expected{return Err("Unexpected trailing Photoshop HTTP data.".into());}
                return Ok(HttpRequest{method:method.clone(),path:path.clone(),token:token.clone(),body:buffer[*end..expected].to_vec()});
            }
        }
    }
}

fn write_response(stream:&mut TcpStream,status:&str,body:&str)->Result<(),String>{
    stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|e|format!("Socket write timeout: {e}"))?;
    if body.len()>MAX_BODY_BYTES{return Err("Photoshop response exceeds 256 KiB.".into());}
    let response=format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, X-Shuvi-Token\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        body.len(),body
    );
    stream.write_all(response.as_bytes()).map_err(|e|format!("Could not write Photoshop bridge response: {e}"))
}

fn handle_client(mut stream:TcpStream,shared:Arc<PhotoshopBridgeShared>){
    let request=match read_request(&mut stream){
        Ok(request)=>request,
        Err(error)=>{
            let _=write_response(&mut stream,"400 Bad Request",&json!({"ok":false,"error":error}).to_string());
            return;
        }
    };
    if request.method=="OPTIONS"{let _=write_response(&mut stream,"204 No Content","");return;}
    if !shared.authenticate(request.token.as_deref()){
        let _=write_response(&mut stream,"401 Unauthorized",r#"{"ok":false,"error":"Invalid or disabled Shuvi pairing token."}"#);
        return;
    }
    shared.mark_seen();
    let route=request.path.split('?').next().unwrap_or_default();
    match (request.method.as_str(),route){
        ("GET","/health")=>{
            let _=write_response(&mut stream,"200 OK",&json!({"ok":true,"service":"shuvi-photoshop-bridge","port":PHOTOSHOP_BRIDGE_PORT,"read_only":true}).to_string());
        }
        ("GET","/command")=>{
            let command=shared.work.lock().ok().and_then(|mut work|{
                if shared.authenticate(request.token.as_deref()){work.dispatch()}else{None}
            });
            let body=serde_json::to_string(&command).unwrap_or_else(|_|"null".into());
            let _=write_response(&mut stream,"200 OK",&body);
        }
        ("POST","/result")=>{
            let parsed=serde_json::from_slice::<PhotoshopBridgeResult>(&request.body);
            match parsed{
                Ok(result) if !result.id.trim().is_empty()&&ALLOWED_ACTIONS.contains(&result.action.as_str())=>{
                    let outcome=shared.work.lock().map_err(|_|"Photoshop queue is unavailable.".to_string()).and_then(|mut work|{
                        if !shared.authenticate(request.token.as_deref()){return Err("Pairing session changed.".into());}
                        work.complete(result)
                    });
                    match outcome{
                        Ok(())=>{let _=write_response(&mut stream,"200 OK",r#"{"ok":true}"#);}
                        Err(error)=>{let _=write_response(&mut stream,"409 Conflict",&json!({"ok":false,"error":error}).to_string());}
                    }
                }
                Ok(_)=>{let _=write_response(&mut stream,"400 Bad Request",r#"{"ok":false,"error":"Invalid Photoshop result identity or action."}"#);}
                Err(error)=>{let _=write_response(&mut stream,"400 Bad Request",&json!({"ok":false,"error":format!("Invalid result payload: {error}")}).to_string());}
            }
        }
        _=>{let _=write_response(&mut stream,"404 Not Found",r#"{"ok":false,"error":"Unknown Photoshop bridge route."}"#);}
    }
}

#[cfg(test)]
mod tests{
    use super::*;

    #[test]
    fn allowlist_is_read_only(){
        assert_eq!(READ_ONLY_ACTIONS,&["inspect_context","list_layers"]);
        assert_eq!(MUTATING_ACTIONS,&["set_layer_property","set_text_layer","transform_layer","set_layer_mask","save_document"]);
        assert!(ALLOWED_ACTIONS.contains(&"set_layer_property"));
        assert!(ALLOWED_ACTIONS.contains(&"set_text_layer"));
        assert!(ALLOWED_ACTIONS.contains(&"transform_layer"));
        assert!(ALLOWED_ACTIONS.contains(&"set_layer_mask"));
        assert!(ALLOWED_ACTIONS.contains(&"save_document"));
        for forbidden in ["delete_layer","merge_layers","rasterize_layer","save_document","batch_play"]{
            assert!(!ALLOWED_ACTIONS.contains(&forbidden));
        }
    }

    #[test]
    fn headers_reject_ambiguous_or_unbounded_framing(){
        for headers in [
            "POST /result HTTP/1.1\r\n\r\n",
            "POST /result HTTP/1.1\r\nContent-Length: nope\r\n\r\n",
            "POST /result HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n",
            "POST /result HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n",
            "GET /command HTTP/1.1\r\nX-Shuvi-Token: a\r\nX-Shuvi-Token: b\r\n\r\n",
        ]{assert!(parse_headers(headers).is_err());}
    }

    #[test]
    fn token_rotation_rejects_old_pairing(){
        let shared=PhotoshopBridgeShared::default();
        *shared.enabled.lock().unwrap()=true;
        *shared.token.lock().unwrap()=Some("first".into());
        *shared.token_created.lock().unwrap()=Some(std::time::Instant::now());
        assert!(shared.authenticate(Some("first")));
        *shared.token.lock().unwrap()=Some("second".into());
        assert!(!shared.authenticate(Some("first")));
    }
}
