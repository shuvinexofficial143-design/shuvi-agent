/* Shuvi Illustrator CEP host adapter. 60% milestone: bounded read-only ExtendScript only. */
function shuviIllustratorBoundString(value,maxLength)
{
    var text="";
    try{text=String(value);}catch(e){text="";}
    if(text.length>maxLength)text=text.substring(0,maxLength);
    return text;
}
function shuviIllustratorContext()
{
    var out={schemaVersion:1,hostName:"Adobe Illustrator",hostVersion:null,hasDocument:false,documentName:null,
        documentPath:null,saved:null,artboardCount:0,activeArtboardIndex:0,layerCount:0,pageItemCount:0,selectionCount:0,
        documentSignature:"no_document",documentSignatureScope:"observational_read_only_not_persistent_id",
        readOnly:true,runtimeVerified:false};
    try{out.hostVersion=shuviIllustratorBoundString(app.version,80);}catch(e0){}
    var doc=null;
    try{if(app.documents&&app.documents.length>0)doc=app.activeDocument;}catch(e1){doc=null;}
    if(!doc)return out;
    out.hasDocument=true;
    try{out.documentName=shuviIllustratorBoundString(doc.name,512);}catch(e2){}
    try{out.documentPath=doc.fullName?shuviIllustratorBoundString(doc.fullName.fsName,32000):null;}catch(e3){out.documentPath=null;}
    try{out.saved=Boolean(doc.saved);}catch(e4){out.saved=null;}
    try{out.artboardCount=doc.artboards&&typeof doc.artboards.length=="number"?doc.artboards.length:0;}catch(e5){}
    try{out.activeArtboardIndex=Number(doc.artboards.getActiveArtboardIndex());}catch(e6){out.activeArtboardIndex=0;}
    try{out.layerCount=doc.layers&&typeof doc.layers.length=="number"?doc.layers.length:0;}catch(e7){}
    try{out.pageItemCount=doc.pageItems&&typeof doc.pageItems.length=="number"?doc.pageItems.length:0;}catch(e8){}
    try{out.selectionCount=doc.selection&&typeof doc.selection.length=="number"?doc.selection.length:0;}catch(e9){}
    out.documentSignature=shuviIllustratorBoundString([
        out.hostVersion||"",out.documentName||"",out.documentPath||"",String(out.artboardCount),
        String(out.activeArtboardIndex),String(out.layerCount),String(out.pageItemCount)
    ].join("|"),2000);
    return out;
}
function shuviIllustratorInspectArtboards(args)
{
    var maxArtboards=Number(args&&args.maxArtboards!=null?args.maxArtboards:128);
    if(isNaN(maxArtboards)||Math.floor(maxArtboards)!=maxArtboards||maxArtboards<1||maxArtboards>256)
        throw new Error("maxArtboards must be 1..256.");
    var context=shuviIllustratorContext();
    if(!context.hasDocument)throw new Error("Illustrator has no active document.");
    var doc=app.activeDocument,sourceCount=0,rows=[];
    try{sourceCount=doc.artboards.length;}catch(e0){sourceCount=0;}
    var limit=Math.min(sourceCount,maxArtboards);
    for(var i=0;i<limit;++i)
    {
        var artboard=doc.artboards[i],row={index:i,name:"",rect:[0,0,0,0],active:i==context.activeArtboardIndex};
        try{row.name=shuviIllustratorBoundString(artboard.name,512);}catch(e1){}
        try{
            var r=artboard.artboardRect;
            row.rect=[Number(r[0]),Number(r[1]),Number(r[2]),Number(r[3])];
        }catch(e2){row.rect=[0,0,0,0];}
        rows.push(row);
    }
    return {schemaVersion:1,documentSignature:context.documentSignature,sourceArtboardCount:sourceCount,
        returnedArtboardCount:rows.length,activeArtboardIndex:context.activeArtboardIndex,truncated:sourceCount>limit,
        artboards:rows,readOnly:true,runtimeVerified:false};
}
function shuviIllustratorLayerRow(layer,index,documentSignature)
{
    var row={index:index,name:"",visible:false,locked:false,opacity:100,nestedLayerCount:0,pageItemCount:0,layerSignature:""};
    try{row.name=shuviIllustratorBoundString(layer.name,512);}catch(e0){}
    try{row.visible=Boolean(layer.visible);}catch(e1){}
    try{row.locked=Boolean(layer.locked);}catch(e2){}
    try{row.opacity=Number(layer.opacity);}catch(e3){row.opacity=100;}
    try{row.nestedLayerCount=layer.layers&&typeof layer.layers.length=="number"?layer.layers.length:0;}catch(e4){}
    try{row.pageItemCount=layer.pageItems&&typeof layer.pageItems.length=="number"?layer.pageItems.length:0;}catch(e5){}
    row.layerSignature=shuviIllustratorBoundString([
        documentSignature,String(index),row.name,String(row.visible),String(row.locked),String(row.opacity),
        String(row.nestedLayerCount),String(row.pageItemCount)
    ].join("|"),2000);
    return row;
}
function shuviIllustratorInspectLayers(args)
{
    var maxLayers=Number(args&&args.maxLayers!=null?args.maxLayers:128);
    if(isNaN(maxLayers)||Math.floor(maxLayers)!=maxLayers||maxLayers<1||maxLayers>256)
        throw new Error("maxLayers must be 1..256.");
    var context=shuviIllustratorContext();
    if(!context.hasDocument)throw new Error("Illustrator has no active document.");
    var doc=app.activeDocument,sourceCount=0,rows=[];
    try{sourceCount=doc.layers.length;}catch(e0){sourceCount=0;}
    var limit=Math.min(sourceCount,maxLayers);
    for(var i=0;i<limit;++i)rows.push(shuviIllustratorLayerRow(doc.layers[i],i,context.documentSignature));
    return {schemaVersion:1,documentSignature:context.documentSignature,sourceLayerCount:sourceCount,
        returnedLayerCount:rows.length,truncated:sourceCount>limit,layers:rows,readOnly:true,runtimeVerified:false};
}
function shuviIllustratorBounds(item)
{
    try{
        var b=item.geometricBounds;
        return [Number(b[0]),Number(b[1]),Number(b[2]),Number(b[3])];
    }catch(e){return [0,0,0,0];}
}
function shuviIllustratorItemRow(item,index,documentSignature)
{
    var row={index:index,typename:"Unknown",name:null,layerName:null,locked:false,hidden:false,opacity:100,
        geometricBounds:[0,0,0,0],itemSignature:""};
    try{row.typename=shuviIllustratorBoundString(item.typename,160)||"Unknown";}catch(e0){}
    try{row.name=shuviIllustratorBoundString(item.name,1024)||null;}catch(e1){}
    try{row.layerName=item.layer?shuviIllustratorBoundString(item.layer.name,512)||null:null;}catch(e2){}
    try{row.locked=Boolean(item.locked);}catch(e3){}
    try{row.hidden=Boolean(item.hidden);}catch(e4){}
    try{row.opacity=Number(item.opacity);}catch(e5){row.opacity=100;}
    row.geometricBounds=shuviIllustratorBounds(item);
    row.itemSignature=shuviIllustratorBoundString([
        documentSignature,String(index),row.typename,row.name||"",row.layerName||"",
        row.geometricBounds.join(","),String(row.locked),String(row.hidden),String(row.opacity)
    ].join("|"),2000);
    return row;
}
function shuviIllustratorInspectPageItems(args)
{
    var maxItems=Number(args&&args.maxItems!=null?args.maxItems:256);
    if(isNaN(maxItems)||Math.floor(maxItems)!=maxItems||maxItems<1||maxItems>256)
        throw new Error("maxItems must be 1..256.");
    var context=shuviIllustratorContext();
    if(!context.hasDocument)throw new Error("Illustrator has no active document.");
    var doc=app.activeDocument,sourceCount=0,rows=[];
    try{sourceCount=doc.pageItems.length;}catch(e0){sourceCount=0;}
    var limit=Math.min(sourceCount,maxItems);
    for(var i=0;i<limit;++i)rows.push(shuviIllustratorItemRow(doc.pageItems[i],i,context.documentSignature));
    return {schemaVersion:1,documentSignature:context.documentSignature,sourceItemCount:sourceCount,
        returnedItemCount:rows.length,truncated:sourceCount>limit,items:rows,readOnly:true,runtimeVerified:false};
}
function shuviIllustratorInspectSelection(args)
{
    var maxItems=Number(args&&args.maxItems!=null?args.maxItems:64);
    if(isNaN(maxItems)||Math.floor(maxItems)!=maxItems||maxItems<1||maxItems>64)
        throw new Error("maxItems must be 1..64.");
    var context=shuviIllustratorContext();
    if(!context.hasDocument)throw new Error("Illustrator has no active document.");
    var doc=app.activeDocument,selection=[],sourceCount=0,rows=[],signatureParts=[context.documentSignature];
    try{selection=doc.selection||[];sourceCount=selection.length;}catch(e0){selection=[];sourceCount=0;}
    var limit=Math.min(sourceCount,maxItems);
    for(var i=0;i<limit;++i)
    {
        var row=shuviIllustratorItemRow(selection[i],i,context.documentSignature);
        rows.push(row);signatureParts.push(row.itemSignature);
    }
    signatureParts.push(String(sourceCount));
    return {schemaVersion:1,documentSignature:context.documentSignature,sourceSelectionCount:sourceCount,
        returnedItemCount:rows.length,truncated:sourceCount>limit,items:rows,
        selectionSignature:shuviIllustratorBoundString(signatureParts.join("|"),2000),
        selectionSignatureScope:"observational_snapshot_not_stable_object_id",
        readOnly:true,runtimeVerified:false};
}
function shuviIllustratorVerifyIdentity(args)
{
    var expected=args&&typeof args.expectedDocumentSignature=="string"?args.expectedDocumentSignature:"";
    if(!expected.length||expected.length>2000)throw new Error("Exact expected Illustrator document signature is required.");
    var context=shuviIllustratorContext();
    if(context.documentSignature!=expected)throw new Error("Illustrator document identity changed; inspect context again.");
    return {schemaVersion:1,expectedDocumentSignature:expected,observedDocumentSignature:context.documentSignature,
        documentPath:context.documentPath,documentIdentityMatched:true,readOnly:true,mutationAuthorized:false,runtimeVerified:false};
}
function shuviIllustratorDispatch(action,encodedArgs)
{
    try
    {
        var args={};
        if(encodedArgs&&encodedArgs.length){var decoded=decodeURIComponent(encodedArgs);args=eval("("+decoded+")");}
        var data=null;
        if(action=="inspect_context")data=shuviIllustratorContext();
        else if(action=="inspect_artboards")data=shuviIllustratorInspectArtboards(args);
        else if(action=="inspect_layers")data=shuviIllustratorInspectLayers(args);
        else if(action=="inspect_page_items")data=shuviIllustratorInspectPageItems(args);
        else if(action=="inspect_selection")data=shuviIllustratorInspectSelection(args);
        else if(action=="verify_identity")data=shuviIllustratorVerifyIdentity(args);
        else throw new Error("Unsupported Shuvi Illustrator read-only action: "+action);
        return ({ok:true,data:data}).toSource();
    }
    catch(error){return ({ok:false,error:shuviIllustratorBoundString(error,2000)}).toSource();}
}
