const photoshop=require("photoshop");
const {app,core}=photoshop;

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

function findLayerById(doc,targetId){
  let visited=0;
  function walk(layers,depth){
    if(!layers||depth>MAX_DEPTH)return null;
    for(const layer of layers){
      if(visited++>=MAX_LAYERS)return null;
      if(Number(layer.id)===targetId)return layer;
      if(layer.layers&&layer.layers.length){
        const found=walk(layer.layers,depth+1);
        if(found)return found;
      }
    }
    return null;
  }
  return walk(doc.layers,0);
}

function valueForOperation(layer,operation){
  if(operation==="rename")return String(layer.name||"");
  if(operation==="visible")return Boolean(layer.visible);
  if(operation==="opacity")return Number(layer.opacity);
  throw new Error("Unsupported layer property operation.");
}

function primitiveEqual(left,right,operation){
  if(operation==="opacity")return Number.isFinite(Number(left))&&Number.isFinite(Number(right))&&Math.abs(Number(left)-Number(right))<=0.01;
  return left===right;
}

function validateMutationArgs(args){
  if(!args||typeof args!=="object")throw new Error("Mutation arguments are required.");
  const documentId=Number(args.expected_document_id);
  const layerId=Number(args.layer_id);
  if(!Number.isInteger(documentId)||documentId<=0||!Number.isInteger(layerId)||layerId<=0)throw new Error("Exact document/layer IDs are required.");
  const operation=String(args.operation||"");
  if(!["rename","visible","opacity"].includes(operation))throw new Error("Only rename, visible, or opacity is allowed.");
  if(operation==="rename"){
    if(typeof args.expected_value!=="string"||typeof args.value!=="string"||args.value.length<1||args.value.length>512)throw new Error("Rename values are invalid.");
  }else if(operation==="visible"){
    if(typeof args.expected_value!=="boolean"||typeof args.value!=="boolean")throw new Error("Visibility values must be boolean.");
  }else{
    if(typeof args.expected_value!=="number"||typeof args.value!=="number"||!Number.isFinite(args.expected_value)||!Number.isFinite(args.value)
      ||args.expected_value<0||args.expected_value>100||args.value<0||args.value>100)throw new Error("Opacity values must be 0..100.");
  }
  return {documentId,layerId,operation,expectedValue:args.expected_value,value:args.value};
}

async function setLayerProperty(args){
  const request=validateMutationArgs(args);
  const initialDoc=activeDocument();
  if(!initialDoc||Number(initialDoc.id)!==request.documentId)throw new Error("Active document identity changed before mutation.");
  const initialLayer=findLayerById(initialDoc,request.layerId);
  if(!initialLayer)throw new Error("Layer ID is not present in the bounded document tree.");
  const before=valueForOperation(initialLayer,request.operation);
  if(!primitiveEqual(before,request.expectedValue,request.operation))throw new Error("Layer property changed since inspection.");

  let receipt=null;
  await core.executeAsModal(async(executionContext)=>{
    if(executionContext.isCancelled)throw new Error("Photoshop mutation cancelled before execution.");
    const doc=activeDocument();
    if(!doc||Number(doc.id)!==request.documentId)throw new Error("Active document identity changed inside modal execution.");
    const layer=findLayerById(doc,request.layerId);
    if(!layer)throw new Error("Layer identity changed inside modal execution.");
    const current=valueForOperation(layer,request.operation);
    if(!primitiveEqual(current,request.expectedValue,request.operation))throw new Error("Layer property changed before write.");

    const suspension=await executionContext.hostControl.suspendHistory({
      documentID:request.documentId,
      name:"Shuvi: "+request.operation+" layer property"
    });
    let committed=false;
    try{
      if(request.operation==="rename")layer.name=request.value;
      else if(request.operation==="visible")layer.visible=request.value;
      else if(request.operation==="opacity")layer.opacity=request.value;
      const after=valueForOperation(layer,request.operation);
      if(!primitiveEqual(after,request.value,request.operation))throw new Error("Photoshop immediate property readback did not match.");
      await executionContext.hostControl.resumeHistory(suspension,true);
      committed=true;
      receipt={
        document_id:request.documentId,
        layer_id:request.layerId,
        operation:request.operation,
        before,
        after,
        mutation_performed:true,
        history_guard:"suspend_resume_commit"
      };
    }finally{
      if(!committed){
        try{await executionContext.hostControl.resumeHistory(suspension,false);}catch(_){}
      }
    }
  },{commandName:"Shuvi layer "+request.operation});
  if(!receipt)throw new Error("Photoshop mutation completed without a receipt.");
  return receipt;
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
    else if(command.action==="set_layer_property")data=await setLayerProperty(command.arguments||{});
    else throw new Error("Action is not in the bounded Photoshop allowlist.");
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
    setStatus("Connected — guarded bridge\nPort: "+PORT+"\nWrites: rename / visible / opacity only");
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
