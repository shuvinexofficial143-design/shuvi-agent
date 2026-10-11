// Check that a UI mutation targets the single application named by user.
// This is an extra pre-staging check; native Rust still owns authorization.
const APPS=[
 ["premiere",/\bpremi(?:ere|re|er)\b|प्रीमियर|प्रिमियर/iu],
 ["photoshop",/\bphotoshop\b|फोटोशॉप/iu],
 ["blender",/\bblender\b|ब्लेंडर/iu],
 ["after-effects",/\bafter[\s-]?effects?\b|आफ्टर इफेक्ट/iu],
 ["illustrator",/\billustrator\b|इलस्ट्रेटर/iu],
 ["audition",/\baudition\b|ऑडिशन/iu]
];
const MUTATE=new Set(["ui_click","ui_set_value","ui_send_keys","ui_toggle","ui_focus","ui_scroll","ui_expand_collapse"]);
export function requestedAppScope(input){
 if(typeof input!=="string")return null;
 const matches=APPS.filter(([,re])=>re.test(input.slice(0,2500)));
 return matches.length===1?matches[0][0]:null;
}
export function checkRequestedAppTarget(goal,proposal){
 if(!MUTATE.has(proposal?.tool))return {allowed:true,reason:"not_ui_mutation"};
 const expected=requestedAppScope(goal),target=proposal?.arguments?.window;
 if(!expected||typeof target!=="string")return {allowed:true,reason:"native_target_validation_required"};
 const apps=APPS.filter(([,re])=>re.test(target));
 if(apps.length===1&&apps[0][0]!==expected)
  return {allowed:false,reason:"Target application conflicts with the explicitly requested app."};
 return {allowed:true,reason:"no_cross_app_conflict"};
}
