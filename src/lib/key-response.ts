export const createKeyResponse=()=>({amount:0,velocity:0,twist:0,twistVelocity:0,pulse:0,pulseStrength:0,stroke:0,hoverAt:-Infinity});
export type KeyResponse=ReturnType<typeof createKeyResponse>;

export function exciteKey(response:KeyResponse,kind:'press'|'hover',handedness=1){
  const press=kind==='press';
  response.pulse=press?.065:.035;response.pulseStrength=press?.85:.36;
  response.velocity=Math.min(response.velocity+(press?2.8:1.9),6);
  response.twistVelocity+=handedness*(press?.68:.4);
}

export function advanceKeyResponse(response:KeyResponse,delta:number,pressed:boolean,reducedMotion=false){
  if(reducedMotion){response.amount=pressed?.85:0;response.velocity=response.twist=response.twistVelocity=response.pulse=0;return;}
  // Substeps keep the same firm response at 30/60/120 Hz. The softer torsional
  // mode lingers after the short compression; there is no hover-held scale target.
  let remaining=Math.min(delta,.05);
  while(remaining>0){
    const dt=Math.min(remaining,1/120);remaining-=dt;
    const target=pressed?.85:response.pulse>0?response.pulseStrength:0;
    response.pulse=Math.max(0,response.pulse-dt);
    response.velocity+=(target-response.amount)*430*dt;
    response.velocity*=Math.exp(-8.5*dt);response.amount+=response.velocity*dt;
    response.twistVelocity+=-235*response.twist*dt;
    response.twistVelocity*=Math.exp(-5.8*dt);response.twist+=response.twistVelocity*dt;
  }
}
