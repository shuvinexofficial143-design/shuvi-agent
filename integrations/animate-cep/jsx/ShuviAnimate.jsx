/* Shuvi Animate CEP host adapter. 60% milestone: bounded read-only JSFL only. */
function shuviAnimateBoundString(value,maxLength)
{
    var text="";
    try{text=String(value);}catch(e){text="";}
    if(text.length>maxLength)text=text.substring(0,maxLength);
    return text;
}
function shuviAnimateTimelineSignature(context,timeline)
{
    if(!context||!context.hasDocument||!timeline)return "no_timeline";
    var frameCount="",layerCount="";
    try{frameCount=String(Number(timeline.frameCount));}catch(e0){frameCount="";}
    try{layerCount=String(timeline.layers&&typeof timeline.layers.length=="number"?timeline.layers.length:"");}catch(e1){layerCount="";}
    return shuviAnimateBoundString([
        context.documentSignature||"",context.currentTimeline==null?"":context.currentTimeline,
        context.timelineName||"",frameCount,layerCount
    ].join("|"),2000);
}
function shuviAnimateContext()
{
    var out={schemaVersion:1,hostName:"Adobe Animate",hostVersion:null,hasDocument:false,documentId:null,documentName:null,
        documentPath:null,documentPathURI:null,width:null,height:null,frameRate:null,currentTimeline:null,timelineName:null,
        currentFrame:0,currentLayer:0,layerCount:0,frameCount:0,selectionCount:0,documentSignature:"no_document",
        timelineSignature:"no_timeline",readOnly:true,runtimeVerified:false};
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
        try{out.frameCount=Number(timeline.frameCount);}catch(e16){}
    }
    out.documentSignature=shuviAnimateBoundString([
        out.hostVersion||"",out.documentId==null?"":out.documentId,out.documentName||"",out.documentPathURI||"",
        out.currentTimeline==null?"":out.currentTimeline,out.timelineName||""
    ].join("|"),1600);
    out.timelineSignature=shuviAnimateTimelineSignature(out,timeline);
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
    return {schemaVersion:1,documentSignature:context.documentSignature,timelineSignature:context.timelineSignature,
        timelineName:context.timelineName,currentFrame:context.currentFrame,currentLayer:context.currentLayer,
        sourceLayerCount:sourceCount,returnedLayerCount:layers.length,truncated:sourceCount>limit,
        layers:layers,readOnly:true,runtimeVerified:false};
}
function shuviAnimateInspectLibrary(args)
{
    var maxItems=Number(args&&args.maxItems!=null?args.maxItems:256);
    if(isNaN(maxItems)||Math.floor(maxItems)!=maxItems||maxItems<1||maxItems>256)throw new Error("maxItems must be 1..256.");
    var context=shuviAnimateContext();
    if(!context.hasDocument)throw new Error("Animate has no active document.");
    var doc=fl.getDocumentDOM(),library=doc.library,source=[],items=[];
    try{source=library&&library.items?library.items:[];}catch(e0){source=[];}
    var sourceCount=source&&typeof source.length=="number"?source.length:0;
    var limit=Math.min(sourceCount,maxItems);
    var signatureParts=[context.documentSignature,String(sourceCount)];
    for(var i=0;i<limit;++i)
    {
        var item=source[i],row={index:i,name:"",itemType:"",linkageClassName:null,linkageExportForAS:null,symbolType:null,
            timelineFrameCount:null,timelineLayerCount:null};
        try{row.name=shuviAnimateBoundString(item.name,1024);}catch(e1){}
        try{row.itemType=shuviAnimateBoundString(item.itemType,160);}catch(e2){}
        try{row.linkageClassName=shuviAnimateBoundString(item.linkageClassName,512)||null;}catch(e3){}
        try{row.linkageExportForAS=Boolean(item.linkageExportForAS);}catch(e4){}
        try{row.symbolType=shuviAnimateBoundString(item.symbolType,160)||null;}catch(e5){}
        try{
            if(item.timeline){
                row.timelineFrameCount=Number(item.timeline.frameCount);
                row.timelineLayerCount=item.timeline.layers&&typeof item.timeline.layers.length=="number"?item.timeline.layers.length:null;
            }
        }catch(e6){}
        if(signatureParts.length<130)signatureParts.push(row.name+"#"+row.itemType);
        items.push(row);
    }
    return {schemaVersion:1,documentSignature:context.documentSignature,timelineSignature:context.timelineSignature,
        sourceItemCount:sourceCount,returnedItemCount:items.length,truncated:sourceCount>limit,items:items,
        librarySnapshotSignature:shuviAnimateBoundString(signatureParts.join("|"),4000),
        librarySnapshotScope:"bounded_observational_not_content_fingerprint",readOnly:true,runtimeVerified:false};
}
function shuviAnimateElementRow(element,index)
{
    var row={index:index,elementType:"",name:null,instanceType:null,symbolType:null,libraryItemName:null,libraryItemType:null,
        x:null,y:null,width:null,height:null,rotation:null};
    try{row.elementType=shuviAnimateBoundString(element.elementType,160);}catch(e0){}
    try{row.name=shuviAnimateBoundString(element.name,1024)||null;}catch(e1){}
    try{row.instanceType=shuviAnimateBoundString(element.instanceType,160)||null;}catch(e2){}
    try{row.symbolType=shuviAnimateBoundString(element.symbolType,160)||null;}catch(e3){}
    try{row.x=Number(element.x);}catch(e4){}
    try{row.y=Number(element.y);}catch(e5){}
    try{row.width=Number(element.width);}catch(e6){}
    try{row.height=Number(element.height);}catch(e7){}
    try{row.rotation=Number(element.rotation);}catch(e8){}
    try{
        if(element.libraryItem){
            row.libraryItemName=shuviAnimateBoundString(element.libraryItem.name,1024)||null;
            row.libraryItemType=shuviAnimateBoundString(element.libraryItem.itemType,160)||null;
        }
    }catch(e9){}
    return row;
}
function shuviAnimateInspectSelection(args)
{
    var maxElements=Number(args&&args.maxElements!=null?args.maxElements:64);
    if(isNaN(maxElements)||Math.floor(maxElements)!=maxElements||maxElements<1||maxElements>64)throw new Error("maxElements must be 1..64.");
    var context=shuviAnimateContext();
    if(!context.hasDocument)throw new Error("Animate has no active document.");
    var doc=fl.getDocumentDOM(),selection=[];
    try{selection=doc.selection||[];}catch(e0){selection=[];}
    var sourceCount=selection&&typeof selection.length=="number"?selection.length:0,limit=Math.min(sourceCount,maxElements),elements=[];
    var signatureParts=[context.documentSignature,context.timelineSignature,String(sourceCount)];
    for(var i=0;i<limit;++i)
    {
        var row=shuviAnimateElementRow(selection[i],i);
        elements.push(row);
        signatureParts.push([row.elementType||"",row.name||"",row.instanceType||"",row.libraryItemName||"",
            row.x==null?"":row.x,row.y==null?"":row.y,row.width==null?"":row.width,row.height==null?"":row.height].join("#"));
    }
    return {schemaVersion:1,documentSignature:context.documentSignature,timelineSignature:context.timelineSignature,
        sourceSelectionCount:sourceCount,returnedElementCount:elements.length,truncated:sourceCount>limit,elements:elements,
        selectionSignature:shuviAnimateBoundString(signatureParts.join("|"),2000),
        selectionSignatureScope:"observational_snapshot_not_stable_object_id",readOnly:true,runtimeVerified:false};
}
function shuviAnimateVerifyIdentity(args)
{
    var expectedDocument=args&&typeof args.expectedDocumentSignature=="string"?args.expectedDocumentSignature:"";
    var expectedTimeline=args&&typeof args.expectedTimelineSignature=="string"?args.expectedTimelineSignature:"";
    if(!expectedDocument.length||expectedDocument.length>2000||!expectedTimeline.length||expectedTimeline.length>2000)
        throw new Error("Exact expected Animate document and timeline signatures are required.");
    var context=shuviAnimateContext();
    if(context.documentSignature!=expectedDocument)throw new Error("Animate document identity changed; inspect context again.");
    if(context.timelineSignature!=expectedTimeline)throw new Error("Animate timeline identity changed; inspect timeline again.");
    return {schemaVersion:1,expectedDocumentSignature:expectedDocument,observedDocumentSignature:context.documentSignature,
        expectedTimelineSignature:expectedTimeline,observedTimelineSignature:context.timelineSignature,
        documentIdentityMatched:true,timelineIdentityMatched:true,readOnly:true,mutationAuthorized:false,runtimeVerified:false};
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
        else if(action=="inspect_library")data=shuviAnimateInspectLibrary(args);
        else if(action=="inspect_selection")data=shuviAnimateInspectSelection(args);
        else if(action=="verify_identity")data=shuviAnimateVerifyIdentity(args);
        else throw new Error("Unsupported Shuvi Animate read-only action: "+action);
        return ({ok:true,data:data}).toSource();
    }
    catch(error){return ({ok:false,error:shuviAnimateBoundString(error,2000)}).toSource();}
}
