const fs=require('node:fs');
const path=require('node:path');
const root=process.argv[2]||'artifacts/stamp-calibration';
const W=1080;
const o=fs.readFileSync(path.join(root,'original.bgra'));
const p=fs.readFileSync(path.join(root,'program.bgra'));
const a=fs.readFileSync(path.join(root,'mask.bgra'));
function blur(data,w,h,sigma){
  const r=Math.ceil(3*sigma),kernel=Array.from({length:2*r+1},(_,i)=>Math.exp(-((i-r)**2)/(2*sigma*sigma))),sum=kernel.reduce((x,y)=>x+y,0);
  for(let i=0;i<kernel.length;i++)kernel[i]/=sum;
  const tmp=new Float64Array(w*h),out=new Float64Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let k=-r;k<=r;k++)if(x+k>=0&&x+k<w)s+=data[y*w+x+k]*kernel[k+r];tmp[y*w+x]=s;}
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let k=-r;k<=r;k++)if(y+k>=0&&y+k<h)s+=tmp[(y+k)*w+x]*kernel[k+r];out[y*w+x]=s;}
  return out;
}
function sample(data,w,h,x,y){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
  if(ix<0||iy<0||ix+1>=w||iy+1>=h)return 0;
  return data[iy*w+ix]*(1-fx)*(1-fy)+data[iy*w+ix+1]*fx*(1-fy)+data[(iy+1)*w+ix]*(1-fx)*fy+data[(iy+1)*w+ix+1]*fx*fy;
}
function fit(label,x0,y0,w,h){
  const mask=new Float64Array(w*h),points=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=((y+y0)*W+x+x0)*4;mask[y*w+x]=a[i]/255;
    if(mask[y*w+x]<0.02){const light=(p[i]+p[i+1]+p[i+2])/3,dark=(o[i]+o[i+1]+o[i+2])/3;points.push({x,y,light,delta:light-dark});}
  }
  function score(g,sigma,dx=0,dy=0){
    let sx=0,sy=0,sxx=0,sxy=0;
    for(const q of points){const v=q.light*sample(g,w,h,q.x-dx,q.y-dy);sx+=v;sy+=q.delta;sxx+=v*v;sxy+=v*q.delta;}
    const n=points.length,opacity=(sxy-sx*sy/n)/(sxx-sx*sx/n),bias=(sy-opacity*sx)/n;
    let squared=0,absolute=0,base=0;
    for(const q of points){const v=q.light*sample(g,w,h,q.x-dx,q.y-dy);const e=q.delta-opacity*v-bias;squared+=e*e;absolute+=Math.abs(e);base+=(q.delta-sy/n)**2;}
    return{sigma,dx,dy,opacity,bias,rmse:Math.sqrt(squared/n),mae:absolute/n,baselineRmse:Math.sqrt(base/n),count:n};
  }
  const candidates=[];
  for(let sigma=0.5;sigma<=16;sigma+=0.5){const g=blur(mask,w,h,sigma);candidates.push(score(g,sigma));}
  candidates.sort((a,b)=>a.rmse-b.rmse);
  console.log(label,'best widths',candidates.slice(0,5));
  const refined=[];
  for(let sigma=Math.max(.25,candidates[0].sigma-.5);sigma<=candidates[0].sigma+.5;sigma+=.25){
    const g=blur(mask,w,h,sigma);
    for(let dy=-2;dy<=3;dy+=.5)for(let dx=-2;dx<=2;dx+=.5)refined.push(score(g,sigma,dx,dy));
  }
  refined.sort((a,b)=>a.rmse-b.rmse);
  console.log(label,'best offsets',refined.slice(0,3));
  return refined[0];
}
const result={text:fit('text',25,790,560,180),logo:fit('logo',760,45,290,115)};
fs.writeFileSync(path.join(root,'shadow-fit.json'),JSON.stringify(result,null,2));
const corrected=Buffer.from(p);
for(const [label,x0,y0,w,h] of [['text',0,750,650,280],['logo',710,0,370,200]]){
  const mask=new Float64Array(w*h),settings=result[label];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)mask[y*w+x]=a[((y+y0)*W+x+x0)*4]/255;
  const g=blur(mask,w,h,settings.sigma);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=((y+y0)*W+x+x0)*4,alpha=mask[y*w+x],shadow=settings.opacity*sample(g,w,h,x-settings.dx,y-settings.dy);
    for(let c=0;c<3;c++)corrected[i+c]=Math.max(0,Math.round(p[i+c]-Math.max(0,p[i+c]-255*alpha)*shadow));
  }
}
fs.writeFileSync(path.join(root,'shadow-corrected.bgra'),corrected);
for(const [label,x0,y0,w,h] of [['text',45,805,505,140],['logo',780,65,250,75]]){
 let before=0,after=0,n=0;
 for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)for(let c=0;c<3;c++){const i=(y*W+x)*4+c;before+=Math.abs(o[i]-p[i]);after+=Math.abs(o[i]-corrected[i]);n++;}
 console.log(label,'MAE before',before/n,'after',after/n);
}
