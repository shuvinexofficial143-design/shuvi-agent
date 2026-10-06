/* Shuvi Animate CEP host adapter. 40% milestone: read-only JSFL only. */
function shuviAnimateBoundString(value,maxLength)
{
    var text="";
    try{text=String(value);}catch(e){text="";}
    if(text.length>maxLength)text=text.substring(0,maxLength);
    return text;
}
function shuviAnimateContext()
{
    var out={schemaVersion:1,hostName:"Adobe Animate",hostVersion:null,hasDocument:false,documentId:null,documentName:null,
        documentPath:null,documentPathURI:null,width:null,height:null,frameRate:null,currentTimeline:null,timelineName:null,
        currentFrame:0,currentLayer:0,layerCount:0,selectionCount:0,documentSignature:"no_document",readOnly:true,runtimeVerified:false};
    try{out.hostVersion=shuviAnimateBoundString(fl.version,80);}catch(e0){}
    var doc=null;try{doc=fl.getDocumentDOM();}catch(e1){doc=null;}
    if(!doc)return out;
    out.hasDocument=true;
    try{out.documentId=Number(doc.id);}catch(e2){}
    try{out.documentName=shuviAnimateBoundString(doc.name,512);}catch(e3){}
    try{out.documentPath=shuviAnimateBoundString(doc.path,32000)||null;}catch(e4){}
    try{out.documentPathURI=shuviAnimateBoundString(doc.pathURI,32000)||null;}catch(e5){}
    try{out.width=Number(doc.width);}catch(e6){}
    try{out.height=Number(doc.height);}catch(e7){}
    try{out.frameRate=Number(doc.frameRate);}catch(e8){}
    try{out.currentTimeline=Number(doc.currentTimeline);}catch(e9){}
    try{out.selectionCount=doc.selection&&typeof doc.selection.length=="number"?doc.selection.length:0;}catch(e10){}
    var timeline=null;try{timeline=doc.getTimeline();}catch(e11){timeline=null;}
    if(timeline)
    {
        try{out.timelineName=shuviAnimateBoundString(timeline.name,512);}catch(e12){}
        try{out.currentFrame=Number(timeline.currentFrame);}catch(e13){}
        try{out.currentLayer=Number(timeline.currentLayer);}catch(e14){}
        try{out.layerCount=timeline.layers&&typeof timeline.layers.length=="number"?timeline.layers.length:0;}catch(e15){}
    }
    out.documentSignature=shuviAnimateBoundString([
        out.hostVersion||"",out.documentId==null?"":out.documentId,out.documentName||"",out.documentPathURI||"",
        out.currentTimeline==null?"":out.currentTimeline,out.timelineName||""
    ].join("|"),1600);
    return out;
}
function shuviAnimateInspectTimeline(args)
{
    var maxLayers=Number(args&&args.maxLayers!=null?args.maxLayers:128);
    if(isNaN(maxLayers)||Math.floor(maxLayers)!=maxLayers||maxLayers<1||maxLayers>256)throw new Error("maxLayers must be 1..256.");
    var context=shuviAnimateContext();
    if(!context.hasDocument)throw new Error("Animate has no active document.");
    var doc=fl.getDocumentDOM(),timeline=doc.getTimeline(),layers=[],sourceCount=0;
    try{sourceCount=timeline.layers.length;}catch(e0){sourceCount=0;}
    var limit=Math.min(sourceCount,maxLayers);
    for(var i=0;i<limit;++i)
    {
        var layer=timeline.layers[i],row={index:i,name:"",layerType:"",visible:null,locked:null,frameCount:null,currentFrameSummary:null};
        try{row.name=shuviAnimateBoundString(layer.name,512);}catch(e1){}
        try{row.layerType=shuviAnimateBoundString(layer.layerType,120);}catch(e2){}
        try{row.visible=Boolean(layer.visible);}catch(e3){}
        try{row.locked=Boolean(layer.locked);}catch(e4){}
        try{row.frameCount=Number(layer.frameCount);}catch(e5){}
        var frame=null;try{frame=layer.frames&&layer.frames.length>context.currentFrame?layer.frames[context.currentFrame]:null;}catch(e6){frame=null;}
        if(frame)
        {
            var summary={startFrame:null,duration:null,name:null,tweenType:null,elementCount:null};
            try{summary.startFrame=Number(frame.startFrame);}catch(e7){}
            try{summary.duration=Number(frame.duration);}catch(e8){}
            try{summary.name=shuviAnimateBoundString(frame.name,512);}catch(e9){}
            try{summary.tweenType=shuviAnimateBoundString(frame.tweenType,120);}catch(e10){}
            try{summary.elementCount=frame.elements&&typeof frame.elements.length=="number"?frame.elements.length:0;}catch(e11){}
            row.currentFrameSummary=summary;
        }
        layers.push(row);
    }
    return {schemaVersion:1,documentSignature:context.documentSignature,timelineName:context.timelineName,currentFrame:context.currentFrame,
        currentLayer:context.currentLayer,sourceLayerCount:sourceCount,returnedLayerCount:layers.length,truncated:sourceCount>limit,
        layers:layers,readOnly:true,runtimeVerified:false};
}
function shuviAnimateDispatch(action,encodedArgs)
{
    try
    {
        var args={};
        if(encodedArgs&&encodedArgs.length){var decoded=decodeURIComponent(encodedArgs);args=eval("("+decoded+")");}
        var data=null;
        if(action=="inspect_context")data=shuviAnimateContext();
        else if(action=="inspect_timeline")data=shuviAnimateInspectTimeline(args);
        else throw new Error("Unsupported Shuvi Animate read-only action: "+action);
        return ({ok:true,data:data}).toSource();
    }
    catch(error){return ({ok:false,error:shuviAnimateBoundString(error,2000)}).toSource();}
}
