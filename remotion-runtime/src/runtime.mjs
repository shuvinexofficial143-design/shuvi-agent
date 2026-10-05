import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";

const clamp01=(value)=>Math.max(0,Math.min(1,value));
const cubicIn=(t)=>t*t*t;
const cubicOut=(t)=>1-Math.pow(1-t,3);
const cubicInOut=(t)=>t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;

const easedProgress=(left,right,raw)=>{
  const t=clamp01(raw);
  if(left.easing==="hold"||right.easing==="hold") return 0;
  const easeOut=left.easing==="ease_out"||left.easing==="ease_in_out";
  const easeIn=right.easing==="ease_in"||right.easing==="ease_in_out";
  if(easeOut&&easeIn) return cubicInOut(t);
  if(easeOut) return cubicOut(t);
  if(easeIn) return cubicIn(t);
  return t;
};

const evaluateTrack=(track,frame,fallback)=>{
  const keys=track?.keyframes??[];
  if(keys.length===0) return fallback;
  if(keys.length===1||frame<=keys[0].frame_position) return keys[0].value;
  const last=keys[keys.length-1];
  if(frame>=last.frame_position) return last.value;
  for(let index=0;index<keys.length-1;index+=1){
    const left=keys[index];
    const right=keys[index+1];
    if(frame<right.frame_position){
      const span=right.frame_position-left.frame_position;
      if(span<=0) return right.value;
      const progress=easedProgress(left,right,(frame-left.frame_position)/span);
      return left.value+(right.value-left.value)*progress;
    }
  }
  return last.value;
};

const trackValue=(layer,property,frame,fallback)=>{
  const track=(layer.tracks??[]).find((candidate)=>candidate.property===property);
  return evaluateTrack(track,frame,fallback);
};

const cssColor=(rgba)=>{
  if(!Array.isArray(rgba)||rgba.length!==4) return undefined;
  const r=Math.round(clamp01(rgba[0])*255);
  const g=Math.round(clamp01(rgba[1])*255);
  const b=Math.round(clamp01(rgba[2])*255);
  const a=clamp01(rgba[3]);
  return "rgba("+r+","+g+","+b+","+a+")";
};

const ShapeContent=({layer})=>{
  const shape=layer.shape;
  if(!shape) return null;
  const width=shape.size?.[0]??1;
  const height=shape.size?.[1]??1;
  const offsetX=shape.position?.[0]??0;
  const offsetY=shape.position?.[1]??0;
  const style={
    width,
    height,
    boxSizing:"border-box",
    backgroundColor:cssColor(shape.fill_color)??"transparent",
    borderStyle:shape.stroke_color&&shape.stroke_width>0?"solid":"none",
    borderColor:cssColor(shape.stroke_color),
    borderWidth:shape.stroke_width??0,
    borderRadius:shape.kind==="ellipse"?"50%":Math.max(0,shape.roundness??0),
    transform:"translate("+offsetX+"px,"+offsetY+"px)"
  };
  return React.createElement("div",{style});
};

const LayerContent=({layer})=>{
  if(layer.kind==="group") return null;
  if(layer.kind==="shape") return React.createElement(ShapeContent,{layer});
  if(layer.kind==="text"){
    return React.createElement("div",{
      style:{
        maxWidth:"90%",
        color:"white",
        fontFamily:"Arial, sans-serif",
        fontWeight:700,
        fontSize:"6vh",
        lineHeight:1.1,
        textAlign:"center",
        whiteSpace:"pre-wrap",
        textShadow:"0 2px 8px rgba(0,0,0,0.35)"
      }
    },layer.text??"");
  }
  const src=layer.runtime_asset_src?staticFile(layer.runtime_asset_src):null;
  if(!src) return null;
  const mediaStyle={width:"100%",height:"100%",objectFit:"contain"};
  if(layer.kind==="image") return React.createElement(Img,{src,style:mediaStyle});
  if(layer.kind==="video") return React.createElement(OffthreadVideo,{src,style:mediaStyle});
  return null;
};

const SceneContent=({scene,sceneStartFrame})=>{
  const localFrame=useCurrentFrame();
  const {width,height}=useVideoConfig();
  const globalFrame=sceneStartFrame+localFrame;
  return React.createElement(React.Fragment,null,
    ...(scene.layers??[]).map((layer,index)=>{
      const x=trackValue(layer,"x",globalFrame,width/2);
      const y=trackValue(layer,"y",globalFrame,height/2);
      const scaleX=trackValue(layer,"scale_x",globalFrame,1);
      const scaleY=trackValue(layer,"scale_y",globalFrame,1);
      const rotation=trackValue(layer,"rotation_degrees",globalFrame,0);
      const opacity=trackValue(layer,"opacity",globalFrame,1);
      const style={
        position:"absolute",
        left:x,
        top:y,
        width,
        height,
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        transformOrigin:"50% 50%",
        transform:"translate(-50%,-50%) scale("+scaleX+","+scaleY+") rotate("+rotation+"deg)",
        opacity:clamp01(opacity),
        zIndex:index,
        overflow:"visible"
      };
      return React.createElement("div",{key:layer.id,style},React.createElement(LayerContent,{layer}));
    })
  );
};

export const ShuviMotion=({manifest})=>{
  const {durationInFrames}=useVideoConfig();
  const transparent=Boolean(manifest?.composition?.transparent_background);
  const rootStyle=transparent?{backgroundColor:"transparent"}:{backgroundColor:"black"};
  const children=(manifest?.scenes??[]).map((scene)=>{
    const from=Math.max(0,Math.round(scene.start_frame_position));
    const requested=Math.max(1,Math.round(scene.duration_frame_span));
    const available=Math.max(1,durationInFrames-from);
    const duration=Math.max(1,Math.min(requested,available));
    return React.createElement(Sequence,{
      key:scene.id,
      from,
      durationInFrames:duration,
      name:scene.id
    },React.createElement(SceneContent,{scene,sceneStartFrame:from}));
  });
  return React.createElement(AbsoluteFill,{style:rootStyle},...children);
};
