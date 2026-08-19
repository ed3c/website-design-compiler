export type MotionRuntimeState="PENDING"|"ACTIVE"|"SETTLED"|"VISIBLE_NO_MOTION"|"CLEANED";
export type MotionRuntimeEvent="ACTIVATE"|"COMPLETE"|"SHOW_STATIC"|"ROUTE_CLEANUP";

export function transitionMotionRuntimeState(current:MotionRuntimeState,event:MotionRuntimeEvent):MotionRuntimeState{
  if(current==="CLEANED")return"CLEANED";
  if(event==="ROUTE_CLEANUP")return"CLEANED";
  if(event==="ACTIVATE")return"ACTIVE";
  if(event==="COMPLETE")return"SETTLED";
  return"VISIBLE_NO_MOTION";
}
