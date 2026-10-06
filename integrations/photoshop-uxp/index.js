const photoshop=require("photoshop");
const {app}=photoshop;

const PORT=17363;
const BASE="http://127.0.0.1:"+PORT;
const MAX_LAYERS=256;
const MAX_DEPTH=8;
let token="";
let running=false;
let timer=null;

function setStatus(text){document.getElementById("status").textContent=text;}

function primitive(value){
  if(value===null||value===undefined)return null;
  if(typeof value==="string"||typeof value==="number"||typeof value==="boolean")return value;
  return String(value);
}

function activeDocument(){
  const docs=app.documents;
  if(!docs||docs.length===0)return null;
  try{return app.activeDocument||docs[0];}catch(_){return docs[0];}
}

function docContext(){
  const doc=activeDocument();
  if(!doc){
    return {
      document_open:false,
      document_id:null,
      title:null,
      width:null,
      height:null,
      resolution:null,
      mode:null,
      active_layer_ids:[],
      read_only:true
    };
  }
  const active=(doc.activeLayers||[]).slice(0,32).map(layer=>Number(layer.id)).filter(Number.isFinite);
  return {
    document_open:true,
    document_id:Number(doc.id),
    title:String(doc.title||doc.name||""),
    width:primitive(doc.width),
    height:primitive(doc.height),
    resolution:primitive(doc.resolution),
    mode:primitive(doc.mode),
    active_layer_ids:active,
    read_only:true
  };
}

function layerRecord(layer,depth,parentId){
  return {
    id:Number(layer.id),
    name:String(layer.name||""),
    kind:primitive(layer.kind),
    visible:Boolean(layer.visible),
    opacity:primitive(layer.opacity),
    depth,
    parent_id:parentId,
    has_children:Boolean(layer.layers&&layer.layers.length)
  };
}

function listLayers(){
  const doc=activeDocument();
  if(!doc)return {document_open:false,document_id:null,layers:[],truncated:false,read_only:true};
  const result=[];
  let truncated=false;
  function walk(layers,depth,parentId){
    if(!layers||depth>MAX_DEPTH)return;
    for(const layer of layers){
      if(result.length>=MAX_LAYERS){truncated=true;return;}
      const id=Number(layer.id);
      if(!Number.isFinite(id))continue;
      result.push(layerRecord(layer,depth,parentId));
      if(layer.layers&&layer.layers.length&&depth<MAX_DEPTH){
        walk(layer.layers,depth+1,id);
        if(truncated)return;
      }
    }
  }
  walk(doc.layers,0,null);
  return {
    document_open:true,
    document_id:Number(doc.id),
    layers:result,
    layer_count:result.length,
    truncated,
    max_layers:MAX_LAYERS,
    max_depth:MAX_DEPTH,
    read_only:true
  };
}

async function send(path,options={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),2500);
  try{
    const response=await fetch(BASE+path,{
      ...options,
      signal:controller.signal,
      headers:{...(options.headers||{}),"X-Shuvi-Token":token}
    });
    if(!response.ok)throw new Error("HTTP "+response.status);
    if(response.status===204)return null;
    return await response.json();
  }finally{clearTimeout(timeout);}
}

async function postResult(command,success,data,error){
  await send("/result",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({
      id:command.id,
      action:command.action,
      success,
      data:success?data:null,
      error:success?null:String(error||"Photoshop command failed")
    })
  });
}

async function execute(command){
  if(!command||typeof command!=="object")return;
  if(typeof command.id!=="string"||typeof command.action!=="string")return;
  try{
    let data;
    if(command.action==="inspect_context")data=docContext();
    else if(command.action==="list_layers")data=listLayers();
    else throw new Error("Action is not in the read-only Photoshop allowlist.");
    await postResult(command,true,data,null);
  }catch(error){
    await postResult(command,false,null,error&&error.message?error.message:error);
  }
}

async function poll(){
  if(!running)return;
  try{
    await send("/health");
    const command=await send("/command");
    if(command)await execute(command);
    setStatus("Connected — read-only bridge\nPort: "+PORT);
  }catch(error){
    setStatus("Bridge unavailable: "+(error&&error.message?error.message:error));
  }finally{
    if(running)timer=setTimeout(poll,250);
  }
}

document.getElementById("connect").addEventListener("click",()=>{
  const value=document.getElementById("token").value.trim();
  if(!/^[0-9a-fA-F]{32}$/.test(value)){setStatus("Paste the 32-character Shuvi pairing token.");return;}
  token=value;
  running=true;
  if(timer)clearTimeout(timer);
  poll();
});

document.getElementById("disconnect").addEventListener("click",()=>{
  running=false;
  token="";
  if(timer)clearTimeout(timer);
  timer=null;
  document.getElementById("token").value="";
  setStatus("Disconnected.");
});
