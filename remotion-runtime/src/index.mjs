import React from "react";
import {Composition,registerRoot} from "remotion";
import {ShuviMotion} from "./runtime.mjs";

const fallbackManifest={
  composition:{
    id:"ShuviMotion",
    width:1920,
    height:1080,
    fps:30,
    duration_in_frames:1,
    transparent_background:true
  },
  scenes:[]
};

const calculateMetadata=({props})=>{
  const manifest=props?.manifest??fallbackManifest;
  const composition=manifest.composition??fallbackManifest.composition;
  return {
    width:composition.width,
    height:composition.height,
    fps:composition.fps,
    durationInFrames:composition.duration_in_frames
  };
};

const Root=()=>React.createElement(Composition,{
  id:"ShuviMotion",
  component:ShuviMotion,
  width:1920,
  height:1080,
  fps:30,
  durationInFrames:1,
  defaultProps:{manifest:fallbackManifest},
  calculateMetadata
});

registerRoot(Root);
