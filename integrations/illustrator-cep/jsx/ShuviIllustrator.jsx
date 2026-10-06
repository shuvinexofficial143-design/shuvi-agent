/* Shuvi Illustrator CEP host adapter. 40% milestone: read-only ExtendScript only. */
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
function shuviIllustratorDispatch(action,encodedArgs)
{
    try
    {
        var args={};
        if(encodedArgs&&encodedArgs.length){var decoded=decodeURIComponent(encodedArgs);args=eval("("+decoded+")");}
        var data=null;
        if(action=="inspect_context")data=shuviIllustratorContext();
        else if(action=="inspect_artboards")data=shuviIllustratorInspectArtboards(args);
        else throw new Error("Unsupported Shuvi Illustrator read-only action: "+action);
        return ({ok:true,data:data}).toSource();
    }
    catch(error){return ({ok:false,error:shuviIllustratorBoundString(error,2000)}).toSource();}
}
