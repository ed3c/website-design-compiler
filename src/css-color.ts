export interface SrgbaColor{red:number;green:number;blue:number;alpha:number}

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const component=(value:string,scale=1)=>value.endsWith("%")?Number(value.slice(0,-1))/100:Number(value)/scale;

export function parseCssColor(value:string):SrgbaColor|null{
  const normalized=value.trim().toLowerCase();
  if(normalized==="transparent")return{red:0,green:0,blue:0,alpha:0};
  const rgb=/^rgba?\((.*)\)$/.exec(normalized);
  if(rgb){
    const [channels,slashAlpha]=rgb[1]!.split("/").map((entry)=>entry.trim());
    const parts=channels!.replaceAll(","," ").split(/\s+/).filter(Boolean);
    const alpha=slashAlpha??parts[3]??"1";
    if(parts.length<3)return null;
    const color={red:component(parts[0]!,255),green:component(parts[1]!,255),blue:component(parts[2]!,255),alpha:component(alpha)};
    return Object.values(color).every(Number.isFinite)?{red:clamp01(color.red),green:clamp01(color.green),blue:clamp01(color.blue),alpha:clamp01(color.alpha)}:null;
  }
  const srgb=/^color\(srgb\s+([^)]*)\)$/.exec(normalized);
  if(srgb){
    const [channels,alpha="1"]=srgb[1]!.split("/").map((entry)=>entry.trim());
    const parts=channels!.split(/\s+/).filter(Boolean);
    if(parts.length!==3)return null;
    const color={red:component(parts[0]!),green:component(parts[1]!),blue:component(parts[2]!),alpha:component(alpha)};
    return Object.values(color).every(Number.isFinite)?{red:clamp01(color.red),green:clamp01(color.green),blue:clamp01(color.blue),alpha:clamp01(color.alpha)}:null;
  }
  const oklch=/^oklch\(([^)]*)\)$/.exec(normalized);
  if(!oklch)return null;
  const [channels,alpha="1"]=oklch[1]!.split("/").map((entry)=>entry.trim());
  const parts=channels!.split(/\s+/).filter(Boolean);
  if(parts.length!==3)return null;
  const lightness=component(parts[0]!);const chroma=Number(parts[1]);const hue=Number(parts[2]!.replace(/deg$/,""))*Math.PI/180;
  if(![lightness,chroma,hue].every(Number.isFinite))return null;
  const a=chroma*Math.cos(hue);const b=chroma*Math.sin(hue);
  const lRoot=lightness+.3963377774*a+.2158037573*b;
  const mRoot=lightness-.1055613458*a-.0638541728*b;
  const sRoot=lightness-.0894841775*a-1.291485548*b;
  const l=lRoot**3;const m=mRoot**3;const s=sRoot**3;
  const linear=[4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,-.0041960863*l-.7034186147*m+1.707614701*s];
  const encode=(channel:number)=>clamp01(channel<=.0031308?12.92*channel:1.055*channel**(1/2.4)-.055);
  return{red:encode(linear[0]!),green:encode(linear[1]!),blue:encode(linear[2]!),alpha:clamp01(component(alpha))};
}

function over(foreground:SrgbaColor,background:SrgbaColor):SrgbaColor{
  const alpha=foreground.alpha+background.alpha*(1-foreground.alpha);
  if(alpha===0)return{red:0,green:0,blue:0,alpha:0};
  const channel=(key:"red"|"green"|"blue")=>(foreground[key]*foreground.alpha+background[key]*background.alpha*(1-foreground.alpha))/alpha;
  return{red:channel("red"),green:channel("green"),blue:channel("blue"),alpha};
}

function luminance(color:SrgbaColor):number{
  const linear=(value:number)=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4;
  return.2126*linear(color.red)+.7152*linear(color.green)+.0722*linear(color.blue);
}

export function cssContrastRatio(foreground:string,backgrounds:readonly string[]):number|null{
  const text=parseCssColor(foreground);if(!text)return null;
  let background:SrgbaColor={red:0,green:0,blue:0,alpha:0};
  for(const value of [...backgrounds].reverse()){
    const layer=parseCssColor(value);if(layer)background=over(layer,background);
  }
  if(background.alpha<.999)return null;
  const renderedText=over(text,background);
  const first=luminance(renderedText);const second=luminance(background);
  return(Math.max(first,second)+.05)/(Math.min(first,second)+.05);
}
