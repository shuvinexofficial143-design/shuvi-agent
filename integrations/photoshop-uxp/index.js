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
  let documentPath=null;
  try{documentPath=doc.path?String(doc.path):null;}catch(_){documentPath=null;}
  let saved=false;try{saved=Boolean(doc.saved);}catch(_){}
  let cloudDocument=false;try{cloudDocument=Boolean(doc.cloudDocument);}catch(_){}
  return {
    document_open:true,
    document_id:Number(doc.id),
    title:String(doc.title||doc.name||""),
    width:primitive(doc.width),
    height:primitive(doc.height),
    resolution:primitive(doc.resolution),
    mode:primitive(doc.mode),
    active_layer_ids:active,
    saved,
    cloud_document:cloudDocument,
    document_path:documentPath,
    read_only:true
  };
}

function numeric(value){
  if(typeof value==="number"&&Number.isFinite(value))return value;
  if(value&&typeof value==="object"){
    if(typeof value._value==="number"&&Number.isFinite(value._value))return value._value;
    if(typeof value.value==="number"&&Number.isFinite(value.value))return value.value;
  }
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}

function layerBounds(layer){
  try{
    const bounds=layer.bounds;
    if(!bounds)return null;
    const value={
      left:numeric(bounds.left),
      top:numeric(bounds.top),
      right:numeric(bounds.right),
      bottom:numeric(bounds.bottom)
    };
    return Object.values(value).every(Number.isFinite)?value:null;
  }catch(_){return null;}
}

function textMetadata(layer){
  try{
    const item=layer.textItem;
    if(!item)return null;
    const contents=String(item.contents??"");
    const size=numeric(item.characterStyle&&item.characterStyle.size);
    if(!Number.isFinite(size))return null;
    return {contents,size};
  }catch(_){return null;}
}

function layerRecord(layer,depth,parentId){
  let locked=false,positionLocked=false;
  try{locked=Boolean(layer.locked);}catch(_){}
  try{positionLocked=Boolean(layer.positionLocked);}catch(_){}
  return {
    id:Number(layer.id),
    name:String(layer.name||""),
    kind:primitive(layer.kind),
    visible:Boolean(layer.visible),
    opacity:primitive(layer.opacity),
    locked,
    position_locked:positionLocked,
    bounds:layerBounds(layer),
    text:textMetadata(layer),
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

function readTextState(layer){
  const item=layer.textItem;
  if(!item)throw new Error("Target layer is not a text layer.");
  const size=numeric(item.characterStyle&&item.characterStyle.size);
  if(!Number.isFinite(size))throw new Error("Text layer font size is unavailable.");
  return {contents:String(item.contents??""),size};
}

function validateTextArgs(args){
  if(!args||typeof args!=="object")throw new Error("Text mutation arguments are required.");
  const documentId=Number(args.expected_document_id),layerId=Number(args.layer_id);
  if(!Number.isInteger(documentId)||documentId<=0||!Number.isInteger(layerId)||layerId<=0)throw new Error("Exact text document/layer IDs are required.");
  if(typeof args.expected_contents!=="string"||args.expected_contents.length>16384)throw new Error("Expected text contents are invalid.");
  const expectedSize=Number(args.expected_size);
  if(!Number.isFinite(expectedSize)||expectedSize<=0||expectedSize>20000)throw new Error("Expected text size is invalid.");
  const hasContents=args.contents!==null&&args.contents!==undefined;
  const hasSize=args.size!==null&&args.size!==undefined;
  if(!hasContents&&!hasSize)throw new Error("Text mutation requires contents and/or size.");
  if(hasContents&&(typeof args.contents!=="string"||args.contents.length<1||args.contents.length>16384))throw new Error("Text contents are invalid.");
  const size=hasSize?Number(args.size):null;
  if(hasSize&&(!Number.isFinite(size)||size<=0||size>20000))throw new Error("Text font size is invalid.");
  return {documentId,layerId,expectedContents:args.expected_contents,expectedSize,
    contents:hasContents?args.contents:null,size};
}

async function setTextLayer(args){
  const request=validateTextArgs(args);
  const initialDoc=activeDocument();
  if(!initialDoc||Number(initialDoc.id)!==request.documentId)throw new Error("Active document identity changed before text mutation.");
  const initialLayer=findLayerById(initialDoc,request.layerId);
  if(!initialLayer)throw new Error("Text layer ID is not present.");
  const initial=readTextState(initialLayer);
  if(initial.contents!==request.expectedContents||Math.abs(initial.size-request.expectedSize)>0.01)throw new Error("Text state changed since inspection.");

  let receipt=null;
  await core.executeAsModal(async(executionContext)=>{
    const doc=activeDocument();
    if(!doc||Number(doc.id)!==request.documentId)throw new Error("Active document identity changed inside text modal.");
    const layer=findLayerById(doc,request.layerId);
    if(!layer)throw new Error("Text layer identity changed inside modal.");
    const before=readTextState(layer);
    if(before.contents!==request.expectedContents||Math.abs(before.size-request.expectedSize)>0.01)throw new Error("Text state changed before write.");
    const suspension=await executionContext.hostControl.suspendHistory({documentID:request.documentId,name:"Shuvi: edit text layer"});
    let committed=false;
    try{
      const item=layer.textItem;
      if(request.contents!==null)item.contents=request.contents;
      if(request.size!==null)item.characterStyle.size=request.size;
      const after=readTextState(layer);
      const expectedContents=request.contents!==null?request.contents:request.expectedContents;
      const expectedSize=request.size!==null?request.size:request.expectedSize;
      if(after.contents!==expectedContents||Math.abs(after.size-expectedSize)>0.01)throw new Error("Photoshop immediate text readback did not match.");
      await executionContext.hostControl.resumeHistory(suspension,true);
      committed=true;
      receipt={document_id:request.documentId,layer_id:request.layerId,before,after,mutation_performed:true,history_guard:"suspend_resume_commit"};
    }finally{
      if(!committed){try{await executionContext.hostControl.resumeHistory(suspension,false);}catch(_){}}
    }
  },{commandName:"Shuvi edit text layer"});
  if(!receipt)throw new Error("Photoshop text mutation completed without receipt.");
  return receipt;
}

function validateBounds(bounds){
  if(!bounds||typeof bounds!=="object")throw new Error("Expected bounds are required.");
  const value={left:Number(bounds.left),top:Number(bounds.top),right:Number(bounds.right),bottom:Number(bounds.bottom)};
  if(!Object.values(value).every(Number.isFinite))throw new Error("Expected bounds are invalid.");
  return value;
}
function sameBounds(a,b){return ["left","top","right","bottom"].every(key=>Math.abs(Number(a[key])-Number(b[key]))<=0.05);}

function validateTransformArgs(args){
  if(!args||typeof args!=="object")throw new Error("Transform arguments are required.");
  const documentId=Number(args.expected_document_id),layerId=Number(args.layer_id);
  if(!Number.isInteger(documentId)||documentId<=0||!Number.isInteger(layerId)||layerId<=0)throw new Error("Exact transform document/layer IDs are required.");
  const operation=String(args.operation||"");
  if(!["translate","scale","rotate"].includes(operation))throw new Error("Transform operation is not allowed.");
  const expectedBounds=validateBounds(args.expected_bounds);
  const request={documentId,layerId,operation,expectedBounds};
  if(operation==="translate"){
    request.x=Number(args.x);request.y=Number(args.y);
    if(!Number.isFinite(request.x)||!Number.isFinite(request.y)||Math.abs(request.x)>10000||Math.abs(request.y)>10000)throw new Error("Translate is outside bounds.");
  }else if(operation==="scale"){
    request.width=Number(args.width_percent);request.height=Number(args.height_percent);
    if(!Number.isFinite(request.width)||!Number.isFinite(request.height)||request.width<1||request.width>1000||request.height<1||request.height>1000)throw new Error("Scale is outside bounds.");
  }else{
    request.angle=Number(args.angle_degrees);
    if(!Number.isFinite(request.angle)||Math.abs(request.angle)>360)throw new Error("Rotate angle is outside bounds.");
  }
  return request;
}

async function transformLayer(args){
  const request=validateTransformArgs(args);
  const initialDoc=activeDocument();
  if(!initialDoc||Number(initialDoc.id)!==request.documentId)throw new Error("Active document identity changed before transform.");
  const initialLayer=findLayerById(initialDoc,request.layerId);
  if(!initialLayer)throw new Error("Transform layer ID is not present.");
  const initialBounds=layerBounds(initialLayer);
  if(!initialBounds||!sameBounds(initialBounds,request.expectedBounds))throw new Error("Layer bounds changed since inspection.");

  let receipt=null;
  await core.executeAsModal(async(executionContext)=>{
    const doc=activeDocument();
    if(!doc||Number(doc.id)!==request.documentId)throw new Error("Active document identity changed inside transform modal.");
    const layer=findLayerById(doc,request.layerId);
    if(!layer)throw new Error("Transform layer identity changed inside modal.");
    if(Boolean(layer.locked)||Boolean(layer.positionLocked))throw new Error("Transform layer is locked.");
    const beforeBounds=layerBounds(layer);
    if(!beforeBounds||!sameBounds(beforeBounds,request.expectedBounds))throw new Error("Layer bounds changed before transform.");
    const suspension=await executionContext.hostControl.suspendHistory({documentID:request.documentId,name:"Shuvi: "+request.operation+" layer"});
    let committed=false;
    try{
      if(request.operation==="translate")await layer.translate(request.x,request.y);
      else if(request.operation==="scale")await layer.scale(request.width,request.height);
      else await layer.rotate(request.angle);
      const afterBounds=layerBounds(layer);
      if(!afterBounds||sameBounds(afterBounds,beforeBounds))throw new Error("Photoshop transform produced no bounded geometry change.");
      await executionContext.hostControl.resumeHistory(suspension,true);
      committed=true;
      receipt={document_id:request.documentId,layer_id:request.layerId,operation:request.operation,
        before_bounds:beforeBounds,after_bounds:afterBounds,mutation_performed:true,history_guard:"suspend_resume_commit"};
    }finally{
      if(!committed){try{await executionContext.hostControl.resumeHistory(suspension,false);}catch(_){}}
    }
  },{commandName:"Shuvi "+request.operation+" layer"});
  if(!receipt)throw new Error("Photoshop transform completed without receipt.");
  return receipt;
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
    else if(command.action==="set_text_layer")data=await setTextLayer(command.arguments||{});
    else if(command.action==="transform_layer")data=await transformLayer(command.arguments||{});
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
    setStatus("Connected — guarded bridge\nPort: "+PORT+"\nWrites: properties / text / bounded transforms");
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
