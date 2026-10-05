import {bundle} from "@remotion/bundler";
import {getCompositions,renderMedia,renderStill} from "@remotion/renderer";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import {createHash} from "node:crypto";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const runtimeRoot=path.dirname(fileURLToPath(import.meta.url));
const MAX_MANIFEST_BYTES=4*1024*1024;
const MAX_PREVIEW_FRAMES=32;
const allowedKinds=new Set(["text","shape","image","video","group"]);
const allowedBlockers=new Set([
  "remotion_runtime_execution_required",
  "remotion_alpha_output_runtime_not_verified"
]);

const fail=(message)=>{throw new Error("Shuvi Remotion runtime: "+message);};
const sha256File=(file)=>{
  const hash=createHash("sha256");
  hash.update(readFileSync(file));
  return hash.digest("hex");
};
const sha256Text=(text)=>createHash("sha256").update(text,"utf8").digest("hex");

const args=process.argv.slice(2);
const arg=(name)=>{
  const index=args.indexOf(name);
  return index>=0?args[index+1]:null;
};
const manifestPath=arg("--manifest");
const outputPath=arg("--output");
const previewDir=arg("--preview-dir");
const evidencePath=arg("--evidence");
if(!manifestPath) fail("--manifest is required.");
if(!outputPath&&!previewDir) fail("Provide --output and/or --preview-dir.");

const manifestAbsolute=path.resolve(manifestPath);
const manifestBytes=readFileSync(manifestAbsolute);
if(manifestBytes.length===0||manifestBytes.length>MAX_MANIFEST_BYTES) fail("manifest is empty or exceeds 4 MiB.");
const manifestText=manifestBytes.toString("utf8");
let manifest;
try{manifest=JSON.parse(manifestText);}catch(error){fail("manifest is not strict JSON: "+error.message);}

const finite=(value,min,max)=>typeof value==="number"&&Number.isFinite(value)&&value>=min&&value<=max;
const validateManifest=(value)=>{
  if(value?.schema_version!==1||value?.adapter!=="remotion"||value?.source_plan_valid!==true) fail("manifest identity is invalid.");
  if(value?.renderer_candidate!=="remotion") fail("renderer_candidate must be remotion.");
  const c=value?.composition;
  if(!c||c.id!=="ShuviMotion") fail("composition id must be ShuviMotion.");
  if(!Number.isInteger(c.width)||c.width<16||c.width>8192) fail("composition width is invalid.");
  if(!Number.isInteger(c.height)||c.height<16||c.height>8192) fail("composition height is invalid.");
  if(!finite(c.fps,1,240)) fail("composition fps is invalid.");
  if(!Number.isInteger(c.duration_in_frames)||c.duration_in_frames<1) fail("duration_in_frames is invalid.");
  if(!finite(c.duration_seconds,0.1,3600)) fail("duration_seconds is invalid.");
  if(value.delivery==="transparent_overlay"&&c.transparent_background!==true) fail("transparent overlay requires transparent background.");
  if(!Array.isArray(value.scenes)||value.scenes.length<1||value.scenes.length>64) fail("scene count is invalid.");
  for(const scene of value.scenes){
    if(!finite(scene.start_frame_position,0,c.duration_in_frames)) fail("scene start frame is invalid.");
    if(!finite(scene.duration_frame_span,0.0001,c.duration_in_frames)) fail("scene duration is invalid.");
    if(!Array.isArray(scene.layers)||scene.layers.length<1||scene.layers.length>128) fail("scene layer count is invalid.");
    for(const layer of scene.layers){
      if(!allowedKinds.has(layer.kind)) fail("unknown layer kind.");
      if(!Array.isArray(layer.tracks)||layer.tracks.length>32) fail("layer track count is invalid.");
      for(const track of layer.tracks){
        if(!Array.isArray(track.keyframes)||track.keyframes.length<1||track.keyframes.length>96) fail("track keyframe count is invalid.");
        let previous=-Infinity;
        for(const key of track.keyframes){
          if(!finite(key.frame_position,0,c.duration_in_frames)) fail("keyframe frame_position is invalid.");
          if(key.frame_position<=previous) fail("keyframe positions must be strictly increasing.");
          previous=key.frame_position;
        }
      }
    }
  }
  const review=value.review??{sample_times_seconds:[]};
  if(!Array.isArray(review.sample_times_seconds)||review.sample_times_seconds.length>MAX_PREVIEW_FRAMES) fail("review sample count is invalid.");
  for(const sample of review.sample_times_seconds){
    if(!finite(sample,0,c.duration_seconds)) fail("review sample time is invalid.");
  }
  const blockers=Array.isArray(value.blockers)?value.blockers:[];
  for(const blocker of blockers){
    if(!allowedBlockers.has(blocker?.code)) fail("manifest contains an unknown blocker: "+String(blocker?.code));
  }
};
validateManifest(manifest);

const tempRoot=mkdtempSync(path.join(tmpdir(),"shuvi-remotion-"));
const publicDir=path.join(tempRoot,"public");
mkdirSync(publicDir,{recursive:true});
const runtimeManifest=structuredClone(manifest);
const assetEvidence=[];
let assetIndex=0;
for(const scene of runtimeManifest.scenes){
  for(const layer of scene.layers){
    if(layer.kind!=="image"&&layer.kind!=="video") continue;
    const source=layer.asset_path;
    if(typeof source!=="string"||!path.isAbsolute(source)) fail("media layer asset_path must be absolute.");
    if(!existsSync(source)||!statSync(source).isFile()) fail("media asset does not exist as a regular file: "+source);
    const extension=path.extname(source).toLowerCase().slice(0,12)||".bin";
    const staged="asset-"+String(assetIndex).padStart(4,"0")+extension;
    const destination=path.join(publicDir,staged);
    copyFileSync(source,destination);
    layer.runtime_asset_src=staged;
    assetEvidence.push({
      layer_id:layer.id,
      source_path:source,
      staged_name:staged,
      sha256:sha256File(destination),
      bytes:statSync(destination).size
    });
    assetIndex+=1;
  }
}

const inputProps={manifest:runtimeManifest};
const startedAt=new Date().toISOString();
try{
  const serveUrl=await bundle({
    entryPoint:path.join(runtimeRoot,"src","index.mjs"),
    publicDir
  });
  const compositions=await getCompositions(serveUrl,{inputProps});
  const composition=compositions.find((item)=>item.id==="ShuviMotion");
  if(!composition) fail("fixed ShuviMotion composition was not registered.");
  const expected=runtimeManifest.composition;
  if(composition.width!==expected.width||composition.height!==expected.height||
     composition.fps!==expected.fps||composition.durationInFrames!==expected.duration_in_frames){
    fail("resolved Remotion metadata does not match the validated manifest.");
  }

  const previewEvidence=[];
  if(previewDir){
    const absolutePreview=path.resolve(previewDir);
    mkdirSync(absolutePreview,{recursive:true});
    const samples=runtimeManifest.review?.sample_times_seconds??[];
    if(samples.length===0) fail("preview requested but the manifest contains no approved review sample times.");
    for(let index=0;index<samples.length;index+=1){
      const requestedSeconds=samples[index];
      const frame=Math.max(0,Math.min(composition.durationInFrames-1,Math.round(requestedSeconds*composition.fps)));
      const file=path.join(absolutePreview,"sample-"+String(index).padStart(2,"0")+"-frame-"+String(frame).padStart(6,"0")+".png");
      await renderStill({
        composition,
        serveUrl,
        output:file,
        inputProps,
        frame,
        imageFormat:"png"
      });
      previewEvidence.push({
        requested_time_seconds:requestedSeconds,
        rendered_frame:frame,
        rendered_time_seconds:frame/composition.fps,
        file,
        bytes:statSync(file).size,
        sha256:sha256File(file)
      });
    }
  }

  let finalEvidence=null;
  if(outputPath){
    const absoluteOutput=path.resolve(outputPath);
    mkdirSync(path.dirname(absoluteOutput),{recursive:true});
    const transparent=runtimeManifest.delivery==="transparent_overlay";
    const extension=path.extname(absoluteOutput).toLowerCase();
    if(transparent&&extension!==".mov") fail("transparent overlay output must use .mov for the fixed ProRes 4444 route.");
    if(!transparent&&extension!==".mp4") fail("standalone output must use .mp4 for the fixed H.264 route.");
    const renderOptions={
      composition,
      serveUrl,
      outputLocation:absoluteOutput,
      inputProps,
      codec:transparent?"prores":"h264"
    };
    if(transparent){
      renderOptions.imageFormat="png";
      renderOptions.pixelFormat="yuva444p10le";
      renderOptions.proResProfile="4444";
    }
    await renderMedia(renderOptions);
    if(!existsSync(absoluteOutput)||!statSync(absoluteOutput).isFile()||statSync(absoluteOutput).size===0){
      fail("renderMedia returned without a non-empty output file.");
    }
    finalEvidence={
      file:absoluteOutput,
      bytes:statSync(absoluteOutput).size,
      sha256:sha256File(absoluteOutput),
      codec:transparent?"prores":"h264",
      image_format:transparent?"png":null,
      pixel_format_requested:transparent?"yuva444p10le":null,
      prores_profile_requested:transparent?"4444":null,
      alpha_encoding_requested:transparent,
      alpha_channel_probe_verified:false
    };
  }

  const evidence={
    schema_version:1,
    adapter:"shuvi_remotion_runtime",
    manifest_file:manifestAbsolute,
    manifest_sha256:sha256Text(manifestText),
    composition_id:"ShuviMotion",
    started_at:startedAt,
    completed_at:new Date().toISOString(),
    asset_snapshots:assetEvidence,
    scene_timeline_quantization:"scene seconds*fps positions are rounded to the nearest integer render frame; keyframe values are sampled against their exact floating frame positions.",
    preview_frames:previewEvidence,
    preview_render_verified:previewEvidence.length>0,
    final_render:finalEvidence,
    render_output_verified:Boolean(finalEvidence),
    renderer_execution_performed:true,
    arbitrary_provider_code_executed:false,
    fixed_runtime_source:true,
    alpha_channel_probe_verified:false,
    visual_review_verified:false,
    production_ready:false,
    unresolved:runtimeManifest.delivery==="transparent_overlay"
      ?["alpha_channel_probe_required","claude_visual_review_binding_required"]
      :["claude_visual_review_binding_required"]
  };
  const evidenceFile=evidencePath
    ?path.resolve(evidencePath)
    :(outputPath?path.resolve(outputPath)+".shuvi-remotion.json":path.join(path.resolve(previewDir),"shuvi-remotion-evidence.json"));
  mkdirSync(path.dirname(evidenceFile),{recursive:true});
  writeFileSync(evidenceFile,JSON.stringify(evidence,null,2)+"\n","utf8");
  process.stdout.write(JSON.stringify({ok:true,evidence:evidenceFile,preview_frames:previewEvidence.length,final_render:Boolean(finalEvidence)})+"\n");
}finally{
  rmSync(tempRoot,{recursive:true,force:true});
}
