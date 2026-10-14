(function () {
  "use strict";
  var BRIDGE_BASE="http://127.0.0.1:17364", bridgeToken="", pollTimer=null, busy=false;
  var delivered=Object.create(null), deliveredCount=0;
  function el(id){return document.getElementById(id);}
  function show(v){var n=el("output");if(n)n.textContent=v;}
  function setStatus(v,ok){var n=el("bridgeStatus");if(!n)return;n.textContent=v;n.className=ok?"connected":"";}
  function evalHost(action,args){
    return new Promise(function(resolve,reject){
      if(!window.__adobe_cep__||typeof window.__adobe_cep__.evalScript!=="function"){reject(new Error("Animate CEP evalScript is unavailable."));return;}
      var encoded=encodeURIComponent(JSON.stringify(args||{}));
      var script="shuviAnimateDispatch("+JSON.stringify(action)+","+JSON.stringify(encoded)+");";
      window.__adobe_cep__.evalScript(script,function(result){
        try{
          if(!result||result==="EvalScript error.")throw new Error("Animate JSFL evaluation failed.");
          var envelope=eval("("+result+")");
          if(!envelope||envelope.ok!==true)throw new Error(envelope&&envelope.error?String(envelope.error):"Animate host returned an invalid result.");
          resolve(envelope.data);
        }catch(error){reject(error);}
      });
    });
  }
  function bridgeRequest(method,path,body,token,timeoutMs){
    return new Promise(function(resolve,reject){
      var xhr=new XMLHttpRequest();xhr.open(method,BRIDGE_BASE+path,true);xhr.timeout=timeoutMs||3000;
      xhr.setRequestHeader("X-Shuvi-Token",token);xhr.setRequestHeader("Content-Type","application/json");
      xhr.onreadystatechange=function(){if(xhr.readyState!==4)return;var p=null;try{p=xhr.responseText?JSON.parse(xhr.responseText):null;}catch(e){}
        if(xhr.status>=200&&xhr.status<300)resolve(p);else reject(new Error(p&&p.error?p.error:"Bridge HTTP "+xhr.status));};
      xhr.onerror=function(){reject(new Error("Could not reach the Shuvi Animate bridge."));};
      xhr.ontimeout=function(){reject(new Error("Shuvi Animate bridge request timed out."));};
      xhr.send(body==null?null:JSON.stringify(body));
    });
  }
  function claim(command){
    if(!command||typeof command.id!=="string"||!command.id||command.id.length>80||typeof command.action!=="string"||!command.action||command.action.length>80)
      throw new Error("Invalid Shuvi Animate command identity.");
    if(delivered[command.id])throw new Error("Duplicate Animate command delivery rejected.");
    if(deliveredCount>=1024)throw new Error("Pairing delivery budget exhausted; rotate the Shuvi pairing token.");
    delivered[command.id]=true;deliveredCount+=1;
  }
  function boundedInteger(value,min,max,label){
    var n=Number(value);
    if(!isFinite(n)||Math.floor(n)!==n||n<min||n>max)throw new Error(label+" must be an integer from "+min+" to "+max+".");
    return n;
  }
  function boundedSignature(value,label){
    if(typeof value!=="string"||!value.length||value.length>2000)throw new Error("Exact "+label+" signature is required.");
    return value;
  }
  function execute(command){
    var args=command.arguments||{};
    if(command.action==="inspect_context")return evalHost("inspect_context",{});
    if(command.action==="inspect_timeline")return evalHost("inspect_timeline",{maxLayers:boundedInteger(args.maxLayers==null?128:args.maxLayers,1,256,"maxLayers")});
    if(command.action==="inspect_library")return evalHost("inspect_library",{maxItems:boundedInteger(args.maxItems==null?256:args.maxItems,1,256,"maxItems")});
    if(command.action==="inspect_selection")return evalHost("inspect_selection",{maxElements:boundedInteger(args.maxElements==null?64:args.maxElements,1,64,"maxElements")});
    if(command.action==="verify_identity")return evalHost("verify_identity",{
      expectedDocumentSignature:boundedSignature(args.expectedDocumentSignature,"document"),
      expectedTimelineSignature:boundedSignature(args.expectedTimelineSignature,"timeline")
    });
    if(command.action==="set_layer_property"){
      var operation=String(args.operation||"");
      if(operation!=="rename"&&operation!=="visible"&&operation!=="locked")
        return Promise.reject(new Error("Animate layer operation must be rename, visible, or locked."));
      var layerIndex=boundedInteger(args.layerIndex,0,100000,"layerIndex");
      var expectedLayerName=String(args.expectedLayerName||"");
      var expectedLayerType=String(args.expectedLayerType||"");
      if(!expectedLayerName.length||expectedLayerName.length>512||!expectedLayerType.length||expectedLayerType.length>160)
        return Promise.reject(new Error("Exact inspected Animate layer name/type are required."));
      if(typeof args.expectedDocumentPath!=="string"||!args.expectedDocumentPath.length||args.expectedDocumentPath.length>32000)
        return Promise.reject(new Error("Exact local Animate document path is required."));
      return evalHost("set_layer_property",{
        expectedDocumentSignature:boundedSignature(args.expectedDocumentSignature,"document"),
        expectedTimelineSignature:boundedSignature(args.expectedTimelineSignature,"timeline"),
        expectedDocumentPath:args.expectedDocumentPath,
        layerIndex:layerIndex,
        expectedLayerName:expectedLayerName,
        expectedLayerType:expectedLayerType,
        operation:operation,
        expectedValue:args.expectedValue,
        value:args.value
      });
    }
    return Promise.reject(new Error("Unsupported Shuvi Animate command: "+command.action));
  }
  function bounded(command,success,data,error){
    var e={id:command.id,action:command.action,success:success,data:success?data:null,error:success?null:String(error||"Unknown Animate bridge error").slice(0,4000)};
    if(JSON.stringify(e).length>220000)e={id:command.id,action:command.action,success:false,data:null,error:"Animate read-only result exceeded the bounded payload."};
    return e;
  }
  function poll(){
    if(!bridgeToken||busy)return;busy=true;var token=bridgeToken;
    bridgeRequest("GET","/command",null,token,2500).then(function(command){
      if(bridgeToken!==token)return null;setStatus("Connected to Shuvi",true);
      if(!command||!command.id||!command.action)return null;claim(command);show("Running: "+command.action);
      return execute(command).then(function(data){
        return bridgeRequest("POST","/result",bounded(command,true,data,null),token,4000).then(function(){show(JSON.stringify(data,null,2));});
      }).catch(function(error){
        return bridgeRequest("POST","/result",bounded(command,false,null,error),token,4000).then(function(){show("Command failed: "+String(error));});
      });
    }).catch(function(error){setStatus("Not paired: "+String(error),false);})
      .then(function(){busy=false;},function(){busy=false;});
  }
  function startPolling(){if(pollTimer)clearInterval(pollTimer);pollTimer=setInterval(poll,650);poll();}
  function connect(){var token=(el("tokenInput").value||"").trim();if(!token){setStatus("Paste the pairing token from Shuvi.",false);return;}
    bridgeToken=token;delivered=Object.create(null);deliveredCount=0;setStatus("Connecting...",false);startPolling();}
  function disconnect(){bridgeToken="";if(pollTimer)clearInterval(pollTimer);pollTimer=null;setStatus("Disconnected",false);}
  function direct(action,args){evalHost(action,args).then(function(v){show(JSON.stringify(v,null,2));}).catch(function(e){show("Animate inspection failed: "+String(e));});}
  document.addEventListener("DOMContentLoaded",function(){
    el("connect").addEventListener("click",connect);el("disconnect").addEventListener("click",disconnect);
    el("inspect").addEventListener("click",function(){direct("inspect_context",{});});
    el("timeline").addEventListener("click",function(){direct("inspect_timeline",{maxLayers:128});});
    setStatus("Disconnected",false);
  });
}());
